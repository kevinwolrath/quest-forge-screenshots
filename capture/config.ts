import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CaptureOptions,
  ScreenConfig,
  ScreensFile,
  ViewportConfig,
  ViewportsFile,
} from "./types.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertScreens(data: unknown): ScreenConfig[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as ScreensFile).screens)) {
    throw new Error("screens config must be an object with a screens array");
  }

  const screens = (data as ScreensFile).screens;
  if (screens.length === 0) {
    throw new Error("screens config must list at least one screen");
  }

  return screens.map((screen, index) => {
    if (!screen || typeof screen !== "object") {
      throw new Error(`screens[${index}] must be an object`);
    }
    if (!isNonEmptyString(screen.id)) {
      throw new Error(`screens[${index}].id must be a non-empty string`);
    }
    if (!isNonEmptyString(screen.path) || !screen.path.startsWith("/")) {
      throw new Error(
        `screens[${index}].path must be a root-relative path starting with /`,
      );
    }
    if (
      screen.readySelector !== undefined &&
      screen.readySelector !== null &&
      !isNonEmptyString(screen.readySelector)
    ) {
      throw new Error(
        `screens[${index}].readySelector must be a non-empty string or null`,
      );
    }
    return {
      id: screen.id.trim(),
      path: screen.path.trim(),
      readySelector: screen.readySelector ?? null,
    };
  });
}

function assertViewports(data: unknown): ViewportConfig[] {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as ViewportsFile).viewports)
  ) {
    throw new Error("viewports config must be an object with a viewports array");
  }

  const viewports = (data as ViewportsFile).viewports;
  if (viewports.length === 0) {
    throw new Error("viewports config must list at least one viewport");
  }

  return viewports.map((viewport, index) => {
    if (!viewport || typeof viewport !== "object") {
      throw new Error(`viewports[${index}] must be an object`);
    }
    if (!isNonEmptyString(viewport.id)) {
      throw new Error(`viewports[${index}].id must be a non-empty string`);
    }
    for (const key of ["width", "height", "deviceScaleFactor"] as const) {
      const value = viewport[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`viewports[${index}].${key} must be a positive number`);
      }
    }
    if (typeof viewport.isMobile !== "boolean") {
      throw new Error(`viewports[${index}].isMobile must be a boolean`);
    }
    if (typeof viewport.hasTouch !== "boolean") {
      throw new Error(`viewports[${index}].hasTouch must be a boolean`);
    }
    return {
      id: viewport.id.trim(),
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    };
  });
}

export async function loadScreens(filePath: string): Promise<ScreenConfig[]> {
  const raw = await readFile(filePath, "utf8");
  return assertScreens(JSON.parse(raw) as unknown);
}

export async function loadViewports(filePath: string): Promise<ViewportConfig[]> {
  const raw = await readFile(filePath, "utf8");
  return assertViewports(JSON.parse(raw) as unknown);
}

export function resolveCaptureOptions(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): CaptureOptions {
  const baseUrl = env.SCREENSHOT_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      "SCREENSHOT_BASE_URL is required. Set it to the running application origin (no trailing path).",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      `SCREENSHOT_BASE_URL is not a valid URL: ${JSON.stringify(baseUrl)}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      "SCREENSHOT_BASE_URL must not include credentials. Use a credential-free origin.",
    );
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "SCREENSHOT_BASE_URL must be an origin only (scheme + host[+port]), with path /.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SCREENSHOT_BASE_URL must use http or https.");
  }

  const configDir = path.resolve(cwd, env.SCREENSHOT_CONFIG_DIR?.trim() || "config");
  const outputDir = path.resolve(
    cwd,
    env.SCREENSHOT_OUTPUT_DIR?.trim() || "screenshot-output",
  );
  const appCommitSha = env.SCREENSHOT_APP_COMMIT_SHA?.trim() || null;
  const navigationTimeoutMs = Number(env.SCREENSHOT_NAVIGATION_TIMEOUT_MS || 30_000);
  const readyTimeoutMs = Number(env.SCREENSHOT_READY_TIMEOUT_MS || 15_000);

  if (!Number.isFinite(navigationTimeoutMs) || navigationTimeoutMs <= 0) {
    throw new Error("SCREENSHOT_NAVIGATION_TIMEOUT_MS must be a positive number");
  }
  if (!Number.isFinite(readyTimeoutMs) || readyTimeoutMs <= 0) {
    throw new Error("SCREENSHOT_READY_TIMEOUT_MS must be a positive number");
  }

  return {
    baseUrl: parsed.origin,
    outputDir,
    screensPath: path.join(configDir, "screens.json"),
    viewportsPath: path.join(configDir, "viewports.json"),
    appCommitSha,
    navigationTimeoutMs,
    readyTimeoutMs,
  };
}

export function joinUrl(baseUrl: string, routePath: string): string {
  return new URL(routePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}
