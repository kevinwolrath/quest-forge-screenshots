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

export async function waitForFontsAndImages(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    async () => {
      if ("fonts" in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      }

      const images = Array.from(document.images);
      return images.every((image) => image.complete);
    },
    { timeout: timeoutMs },
  );
}
