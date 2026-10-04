export type ScreenConfig = {
  id: string;
  path: string;
  /** Optional CSS selector that must be visible before capture. */
  readySelector?: string | null;
};

export type ViewportConfig = {
  id: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
};

export type ScreensFile = {
  screens: ScreenConfig[];
};

export type ViewportsFile = {
  viewports: ViewportConfig[];
};

export type CaptureResultStatus = "ok" | "failed";

export type CaptureResult = {
  screenId: string;
  path: string;
  viewportId: string;
  width: number;
  height: number;
  file: string | null;
  status: CaptureResultStatus;
  error: string | null;
};

export type RunManifest = {
  capturedAt: string;
  baseUrl: string;
  /** Optional application commit SHA supplied as metadata only. Not verified. */
  appCommitSha: string | null;
  appCommitShaVerified: false;
  outputDir: string;
  viewports: ViewportConfig[];
  routes: Array<{ id: string; path: string; readySelector: string | null }>;
  results: CaptureResult[];
  summary: {
    total: number;
    ok: number;
    failed: number;
  };
};

export type CaptureOptions = {
  baseUrl: string;
  outputDir: string;
  screensPath: string;
  viewportsPath: string;
  appCommitSha: string | null;
  navigationTimeoutMs: number;
  readyTimeoutMs: number;
};
