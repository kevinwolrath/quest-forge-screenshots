import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  joinUrl,
  loadScreens,
  loadViewports,
  resolveCaptureOptions,
} from "../capture/config.ts";

describe("resolveCaptureOptions", () => {
  it("requires SCREENSHOT_BASE_URL", () => {
    assert.throws(
      () => resolveCaptureOptions({}, "/tmp"),
      /SCREENSHOT_BASE_URL is required/,
    );
  });

  it("rejects credentials in the base URL", () => {
    assert.throws(
      () =>
        resolveCaptureOptions(
          { SCREENSHOT_BASE_URL: "http://user:pass@example.test" },
          "/tmp",
        ),
      /must not include credentials/,
    );
  });

  it("rejects a base URL with a non-root path", () => {
    assert.throws(
      () =>
        resolveCaptureOptions(
          { SCREENSHOT_BASE_URL: "http://example.test/app" },
          "/tmp",
        ),
      /origin only/,
    );
  });

  it("normalizes a valid origin and optional metadata", () => {
    const options = resolveCaptureOptions(
      {
        SCREENSHOT_BASE_URL: "http://example.test:4173/",
        SCREENSHOT_APP_COMMIT_SHA: "abc123",
        SCREENSHOT_OUTPUT_DIR: "out",
        SCREENSHOT_CONFIG_DIR: "cfg",
      },
      "/repo",
    );

    assert.equal(options.baseUrl, "http://example.test:4173");
    assert.equal(options.appCommitSha, "abc123");
    assert.equal(options.outputDir, path.resolve("/repo", "out"));
    assert.equal(options.screensPath, path.resolve("/repo", "cfg", "screens.json"));
    assert.equal(options.viewportsPath, path.resolve("/repo", "cfg", "viewports.json"));
  });
});

describe("config files", () => {
  it("loads the committed screens and viewports", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const screens = await loadScreens(path.join(root, "config", "screens.json"));
    const viewports = await loadViewports(path.join(root, "config", "viewports.json"));

    assert.deepEqual(screens, [
      { id: "home", path: "/", readySelector: null },
    ]);
    assert.equal(viewports.length, 3);
    assert.deepEqual(
      viewports.map((viewport) => viewport.id),
      ["desktop", "tablet", "mobile"],
    );
    assert.deepEqual(
      viewports.find((viewport) => viewport.id === "desktop"),
      {
        id: "desktop",
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    );
  });

  it("rejects invalid screens config", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "screens-"));
    const filePath = path.join(dir, "screens.json");
    await writeFile(filePath, JSON.stringify({ screens: [{ id: "x", path: "relative" }] }));
    await assert.rejects(() => loadScreens(filePath), /root-relative path/);
  });
});

describe("joinUrl", () => {
  it("joins a relative screen path to the base origin", () => {
    assert.equal(joinUrl("http://example.test:3000", "/"), "http://example.test:3000/");
    assert.equal(
      joinUrl("http://example.test:3000", "/characters"),
      "http://example.test:3000/characters",
    );
  });
});
