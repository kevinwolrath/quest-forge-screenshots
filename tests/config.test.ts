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

  it("does not echo malformed URL values that may contain credentials", () => {
    const secret = "super-secret-password";
    try {
      resolveCaptureOptions(
        { SCREENSHOT_BASE_URL: `http://user:${secret}@example.test:bad` },
        "/tmp",
      );
      assert.fail("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /not a valid URL/i);
      assert.doesNotMatch(message, new RegExp(secret));
      assert.doesNotMatch(message, /user:/);
    }
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

  it("rejects protocol-relative screen paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "screens-"));
    const filePath = path.join(dir, "screens.json");
    await writeFile(
      filePath,
      JSON.stringify({ screens: [{ id: "evil", path: "//other.test/" }] }),
    );
    await assert.rejects(() => loadScreens(filePath), /not protocol-relative/);
  });

  it("rejects screen ids that can escape the output directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "screens-"));
    const filePath = path.join(dir, "screens.json");
    await writeFile(
      filePath,
      JSON.stringify({ screens: [{ id: "../outside", path: "/" }] }),
    );
    await assert.rejects(() => loadScreens(filePath), /filesystem-safe id/);
  });

  it("rejects duplicate screen ids", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "screens-"));
    const filePath = path.join(dir, "screens.json");
    await writeFile(
      filePath,
      JSON.stringify({
        screens: [
          { id: "home", path: "/" },
          { id: "home", path: "/other" },
        ],
      }),
    );
    await assert.rejects(() => loadScreens(filePath), /duplicate screen id/);
  });

  it("rejects duplicate viewport ids", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "viewports-"));
    const filePath = path.join(dir, "viewports.json");
    await writeFile(
      filePath,
      JSON.stringify({
        viewports: [
          {
            id: "desktop",
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
          },
          {
            id: "desktop",
            width: 1280,
            height: 720,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
          },
        ],
      }),
    );
    await assert.rejects(() => loadViewports(filePath), /duplicate viewport id/);
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

  it("rejects protocol-relative paths that leave the configured origin", () => {
    assert.throws(
      () => joinUrl("http://example.test:3000", "//other.test/"),
      /protocol-relative|origin/,
    );
  });

  it("rejects credentialed resolved URLs", () => {
    assert.throws(
      () => joinUrl("http://example.test:3000", "//user:pass@other.test/"),
      /credentials|protocol-relative|origin/,
    );
  });
});
