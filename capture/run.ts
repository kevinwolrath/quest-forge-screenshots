import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser } from "playwright";

import { joinUrl, loadScreens, loadViewports } from "./config.ts";
import { acquireCaptureLock } from "./lock.ts";
import { clearManagedCaptureOutputs } from "./output.ts";
import { resolveManagedOutputPath } from "./paths.ts";
import { disableAnimations, waitForFontsAndImages } from "./prepare-page.ts";
import type {
  CaptureOptions,
  CaptureResult,
  RunManifest,
  ScreenConfig,
  ViewportConfig,
} from "./types.ts";

function screenshotRelativePath(screen: ScreenConfig, viewport: ViewportConfig): string {
  return path.posix.join(
    screen.id,
    `${viewport.id}-${viewport.width}x${viewport.height}.png`,
  );
}

function describeTarget(screen: ScreenConfig): string {
  return `${screen.id} (${screen.path})`;
}

async function captureOne(
  browser: Browser,
  options: CaptureOptions,
  screen: ScreenConfig,
  viewport: ViewportConfig,
): Promise<CaptureResult> {
  const relativeFile = screenshotRelativePath(screen, viewport);
  const absoluteFile = resolveManagedOutputPath(options.outputDir, relativeFile);
  let targetUrl: string;

  try {
    targetUrl = joinUrl(options.baseUrl, screen.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      screenId: screen.id,
      path: screen.path,
      viewportId: viewport.id,
      width: viewport.width,
      height: viewport.height,
      file: null,
      status: "failed",
      error: `${describeTarget(screen)}: ${message}`,
    };
  }

  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      reducedMotion: "reduce",
    });

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(options.navigationTimeoutMs);
      page.setDefaultNavigationTimeout(options.navigationTimeoutMs);

      const response = await page.goto(targetUrl, { waitUntil: "networkidle" });
      if (!response) {
        throw new Error("navigation produced no response");
      }
      const status = response.status();
      if (status >= 400) {
        throw new Error(`HTTP ${status}`);
      }

      await disableAnimations(page);
      await waitForFontsAndImages(page, options.readyTimeoutMs);

      if (screen.readySelector) {
        await page.waitForSelector(screen.readySelector, {
          state: "visible",
          timeout: options.readyTimeoutMs,
        });
      }

      await mkdir(path.dirname(absoluteFile), { recursive: true });
      await page.screenshot({
        path: absoluteFile,
        fullPage: false,
        animations: "disabled",
      });
    } finally {
      await context.close();
    }

    return {
      screenId: screen.id,
      path: screen.path,
      viewportId: viewport.id,
      width: viewport.width,
      height: viewport.height,
      file: relativeFile,
      status: "ok",
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      screenId: screen.id,
      path: screen.path,
      viewportId: viewport.id,
      width: viewport.width,
      height: viewport.height,
      file: null,
      status: "failed",
      error: `${describeTarget(screen)}: ${message}`,
    };
  }
}

export async function runCapture(options: CaptureOptions): Promise<RunManifest> {
  const screens = await loadScreens(options.screensPath);
  const viewports = await loadViewports(options.viewportsPath);

  // Validate every destination path before acquiring the lock / launching Chromium.
  for (const screen of screens) {
    for (const viewport of viewports) {
      resolveManagedOutputPath(
        options.outputDir,
        screenshotRelativePath(screen, viewport),
      );
      joinUrl(options.baseUrl, screen.path);
    }
  }

  const lock = await acquireCaptureLock(options.outputDir);

  try {
    await mkdir(options.outputDir, { recursive: true });
    await clearManagedCaptureOutputs(options.outputDir);

    const browser = await chromium.launch({ headless: true });
    const results: CaptureResult[] = [];

    try {
      for (const screen of screens) {
        for (const viewport of viewports) {
          const result = await captureOne(browser, options, screen, viewport);
          if (result.status === "ok") {
            console.log(`ok  ${result.file}`);
          } else {
            console.error(`fail ${screen.id}/${viewport.id}: ${result.error}`);
          }
          results.push(result);
        }
      }
    } finally {
      await browser.close();
    }

    const ok = results.filter((result) => result.status === "ok").length;
    const failed = results.length - ok;

    const manifest: RunManifest = {
      capturedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      appCommitSha: options.appCommitSha,
      appCommitShaVerified: false,
      outputDir: options.outputDir,
      viewports,
      routes: screens.map((screen) => ({
        id: screen.id,
        path: screen.path,
        readySelector: screen.readySelector ?? null,
      })),
      results,
      summary: {
        total: results.length,
        ok,
        failed,
      },
    };

    const manifestPath = path.join(options.outputDir, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`wrote ${manifestPath}`);

    return manifest;
  } finally {
    await lock.release();
  }
}
