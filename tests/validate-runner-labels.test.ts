import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const scriptPath = path.resolve(import.meta.dirname, "../scripts/validate-runner-labels.mjs");

describe("parseRunnerLabels", () => {
  it("accepts a non-empty JSON label array", async () => {
    const mod = await import(pathToFileURL(scriptPath).href);
    assert.deepEqual(mod.parseRunnerLabels('["self-hosted","Windows"]'), [
      "self-hosted",
      "Windows",
    ]);
  });

  it("rejects missing labels", async () => {
    const mod = await import(pathToFileURL(scriptPath).href);
    assert.throws(() => mod.parseRunnerLabels(""), /missing/i);
    assert.throws(() => mod.parseRunnerLabels(undefined), /missing/i);
  });

  it("rejects invalid JSON and empty arrays", async () => {
    const mod = await import(pathToFileURL(scriptPath).href);
    assert.throws(() => mod.parseRunnerLabels("{"), /valid JSON/i);
    assert.throws(() => mod.parseRunnerLabels("[]"), /non-empty/i);
    assert.throws(() => mod.parseRunnerLabels('["self-hosted",""]'), /non-empty string/i);
  });
});

describe("validate-runner-labels CLI", () => {
  it("exits non-zero when SCREENSHOT_RUNNER_LABELS is missing", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, SCREENSHOT_RUNNER_LABELS: "" },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing/i);
  });

  it("exits zero for a valid label array", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SCREENSHOT_RUNNER_LABELS: '["self-hosted","Windows","X64"]',
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /runner labels ok/);
  });
});
