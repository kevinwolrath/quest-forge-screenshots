import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { clearManagedCaptureOutputs } from "../capture/output.ts";

describe("clearManagedCaptureOutputs", () => {
  it("removes managed PNGs and manifest while preserving the lock and unrelated files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-out-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "desktop-1440x900.png"), "png");
    await writeFile(path.join(dir, "manifest.json"), "{}");
    await writeFile(path.join(dir, ".capture.lock"), "pid=1\n");
    await writeFile(path.join(dir, "notes.txt"), "keep me");

    await clearManagedCaptureOutputs(dir);

    await assert.rejects(() => access(path.join(dir, "home", "desktop-1440x900.png")));
    await assert.rejects(() => access(path.join(dir, "manifest.json")));
    await access(path.join(dir, ".capture.lock"));
    await access(path.join(dir, "notes.txt"));
  });
});
