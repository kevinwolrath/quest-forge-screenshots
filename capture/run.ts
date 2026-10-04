import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser } from "playwright";

import { joinUrl, loadScreens, loadViewports } from "./config.ts";
import { acquireCaptureLock } from "./lock.ts";
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

async function captureOne(
  browser: Browser,
  options: CaptureOptions,
  screen: ScreenConfig,
  viewport: ViewportConfig,
): Promise<CaptureResult> {
  const relativeFile = screenshotRelativePath(screen, viewport);
  const absoluteFile = path.join(options.outputDir, relativeFile);
  const targetUrl = joinUrl(options.baseUrl, screen.path);

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

      await page.goto(targetUrl, { waitUntil: "networkidle" });
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
      error: `${targetUrl}: ${message}`,
    };
  }
}

export async function runCapture(options: CaptureOptions): Promise<RunManifest> {
  const screens = await loadScreens(options.screensPath);
  const viewports = await loadViewports(options.viewportsPath);
  const lock = await acquireCaptureLock(options.outputDir);

  try {
    await mkdir(options.outputDir, { recursive: true });

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
