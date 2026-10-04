import type { Page } from "playwright";

const ANIMATION_DISABLE_CSS = `
*, *::before, *::after {
  animation: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition: none !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

export async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({ content: ANIMATION_DISABLE_CSS });
  await page.evaluate(() => {
    const doc = document as Document & {
      getAnimations?: (options?: { subtree?: boolean }) => Animation[];
    };
    if (typeof doc.getAnimations === "function") {
      for (const animation of doc.getAnimations({ subtree: true })) {
        try {
          animation.cancel();
        } catch {
          // Ignore animations that cannot be cancelled.
        }
      }
    }
  });
}

function intersectsViewport(
  box: { top: number; left: number; bottom: number; right: number },
  viewport: { width: number; height: number },
): boolean {
  return (
    box.bottom > 0 &&
    box.right > 0 &&
    box.top < viewport.height &&
    box.left < viewport.width
  );
}

/**
 * Policy for viewport screenshots: wait for incomplete images that can appear
 * in the shot; do not wait forever for off-screen lazy images.
 */
export function shouldWaitForImage(
  image: {
    complete: boolean;
    loading: string | null;
    top: number;
    left: number;
    bottom: number;
    right: number;
  },
  viewport: { width: number; height: number },
): boolean {
  if (image.complete) {
    return false;
  }
  if (image.loading !== "lazy") {
    return true;
  }
  return intersectsViewport(image, viewport);
}

/**
 * A settled visible image with naturalWidth 0 is broken (failed decode/load).
 * Off-screen lazy images are ignored, matching screenshot scope.
 */
export function isBrokenVisibleImage(
  image: {
    complete: boolean;
    naturalWidth: number;
    loading: string | null;
    top: number;
    left: number;
    bottom: number;
    right: number;
  },
  viewport: { width: number; height: number },
): boolean {
  if (!intersectsViewport(image, viewport)) {
    return false;
  }
  return image.complete && image.naturalWidth <= 0;
}

export async function waitForFontsAndImages(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  // Playwright signature: waitForFunction(fn, arg, options).
  // Timeout must be the third argument; the second is callback data.
  await page.waitForFunction(
    async () => {
      if ("fonts" in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      }

      const images = Array.from(document.images);
      return images.every((image) => {
        if (image.complete) {
          return true;
        }
        const loading = image.getAttribute("loading");
        if (loading !== "lazy") {
          return false;
        }
        const rect = image.getBoundingClientRect();
        const inViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
        // Off-screen lazy images may never load for a non-full-page shot.
        return !inViewport;
      });
    },
    undefined,
    { timeout: timeoutMs },
  );

  const broken = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return Array.from(document.images)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        const inViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < viewport.height &&
          rect.left < viewport.width;
        return inViewport && image.complete && image.naturalWidth <= 0;
      })
      .map((image) => image.currentSrc || image.src || "(unknown image)");
  });

  if (broken.length > 0) {
    throw new Error(`broken visible image(s): ${broken.join(", ")}`);
  }
}
