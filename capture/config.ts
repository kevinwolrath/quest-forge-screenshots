import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CaptureOptions,
  ScreenConfig,
  ScreensFile,
  ViewportConfig,
  ViewportsFile,
} from "./types.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSafeId(id: string, label: string): string {
  const trimmed = id.trim();
  if (!SAFE_ID.test(trimmed) || trimmed.includes("..")) {
    throw new Error(
      `${label} must be a filesystem-safe id (letters, digits, '.', '_', '-', no '..' or path separators)`,
    );
  }
  return trimmed;
}

function assertUniqueIds(ids: string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`duplicate ${kind} id: ${id}`);
    }
    seen.add(id);
  }
}

function assertScreenPath(routePath: string, label: string): string {
  const trimmed = routePath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    throw new Error(
      `${label} must be a root-relative path starting with / (not protocol-relative //)`,
    );
  }
  if (trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error(`${label} must not contain backslashes or null bytes`);
  }
  return trimmed;
}

function assertScreens(data: unknown): ScreenConfig[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as ScreensFile).screens)) {
    throw new Error("screens config must be an object with a screens array");
  }

  const screens = (data as ScreensFile).screens;
  if (screens.length === 0) {
    throw new Error("screens config must list at least one screen");
  }

  const parsed = screens.map((screen, index) => {
    if (!screen || typeof screen !== "object") {
      throw new Error(`screens[${index}] must be an object`);
    }
    if (!isNonEmptyString(screen.id)) {
      throw new Error(`screens[${index}].id must be a non-empty string`);
    }
    if (!isNonEmptyString(screen.path)) {
      throw new Error(`screens[${index}].path must be a non-empty string`);
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
      id: assertSafeId(screen.id, `screens[${index}].id`),
      path: assertScreenPath(screen.path, `screens[${index}].path`),
      readySelector: screen.readySelector ?? null,
    };
  });

  assertUniqueIds(
    parsed.map((screen) => screen.id),
    "screen",
  );
  return parsed;
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

  const parsed = viewports.map((viewport, index) => {
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
      id: assertSafeId(viewport.id, `viewports[${index}].id`),
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    };
  });

  assertUniqueIds(
    parsed.map((viewport) => viewport.id),
    "viewport",
  );
  return parsed;
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
    // Do not echo the supplied value; it may contain credentials.
    throw new Error("SCREENSHOT_BASE_URL is not a valid URL.");
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

/**
 * Resolve a screen path against the configured origin.
 * Rejects protocol-relative paths, credentialed URLs, and origin escapes.
 */
export function joinUrl(baseUrl: string, routePath: string): string {
  const safePath = assertScreenPath(routePath, "screen path");
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    throw new Error("base URL is not a valid URL.");
  }

  if (base.username || base.password) {
    throw new Error("base URL must not include credentials");
  }

  const resolved = new URL(safePath, base);
  if (resolved.username || resolved.password) {
    throw new Error("resolved screen URL must not include credentials");
  }
  if (resolved.origin !== base.origin) {
    throw new Error(
      "screen path must stay on the configured SCREENSHOT_BASE_URL origin",
    );
  }

  return resolved.toString();
}
