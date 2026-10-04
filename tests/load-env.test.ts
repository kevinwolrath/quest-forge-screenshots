import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadEnvFile } from "../capture/load-env.ts";

describe("loadEnvFile", () => {
  it("returns false when the file is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "env-missing-"));
    const env: NodeJS.ProcessEnv = {};
    assert.equal(await loadEnvFile(path.join(dir, ".env"), env), false);
    assert.deepEqual(env, {});
  });

  it("loads unset keys and leaves existing env values alone", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "env-load-"));
    const filePath = path.join(dir, ".env");
    await writeFile(
      filePath,
      [
        "# comment",
        "SCREENSHOT_BASE_URL=http://from-file:3000",
        "SCREENSHOT_OUTPUT_DIR=from-file",
        "ALREADY_SET=from-file",
        "",
      ].join("\n"),
    );

    const env: NodeJS.ProcessEnv = { ALREADY_SET: "from-process" };
    assert.equal(await loadEnvFile(filePath, env), true);
    assert.equal(env.SCREENSHOT_BASE_URL, "http://from-file:3000");
    assert.equal(env.SCREENSHOT_OUTPUT_DIR, "from-file");
    assert.equal(env.ALREADY_SET, "from-process");
  });
});
