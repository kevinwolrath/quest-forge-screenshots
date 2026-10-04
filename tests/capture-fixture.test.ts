import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveCaptureOptions } from "../capture/config.ts";
import { runCapture } from "../capture/run.ts";
import { startFixtureServer } from "../scripts/fixture-server.ts";

/**
 * Fixture verification only. Passing these tests does not mean QuestForge was
 * captured or verified. Mobile viewport captures use Playwright's Chromium
 * emulation; they are not native Android device tests.
 */
describe("fixture capture", () => {
  it("captures desktop, tablet, and mobile screenshots against the local fixture", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "fixture-capture-"));
    const server = await startFixtureServer();

    try {
      const options = resolveCaptureOptions(
        {
          SCREENSHOT_BASE_URL: server.baseUrl,
          SCREENSHOT_OUTPUT_DIR: outputDir,
          SCREENSHOT_CONFIG_DIR: path.join(root, "config"),
          SCREENSHOT_APP_COMMIT_SHA: "fixture-test-sha",
        },
        root,
      );

      const manifest = await runCapture(options);

      assert.equal(manifest.summary.total, 3);
      assert.equal(manifest.summary.ok, 3);
      assert.equal(manifest.summary.failed, 0);
      assert.equal(manifest.baseUrl, server.baseUrl);
      assert.equal(manifest.appCommitSha, "fixture-test-sha");
      assert.equal(manifest.appCommitShaVerified, false);
      assert.equal(manifest.routes[0]?.path, "/");

      for (const result of manifest.results) {
        assert.equal(result.status, "ok");
        assert.ok(result.file);
        await access(path.join(outputDir, result.file));
      }

      const written = JSON.parse(
        await readFile(path.join(outputDir, "manifest.json"), "utf8"),
      ) as { summary: { ok: number } };
      assert.equal(written.summary.ok, 3);
    } finally {
      await server.close();
    }
  });
});
