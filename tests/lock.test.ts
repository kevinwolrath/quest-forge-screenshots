import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { acquireCaptureLock, writeStaleLockForTests } from "../capture/lock.ts";

describe("acquireCaptureLock", () => {
  it("allows a second acquire only after release", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-lock-"));
    const first = await acquireCaptureLock(dir);

    await assert.rejects(
      () => acquireCaptureLock(dir),
      /Another screenshot capture holds the lock/,
    );

    await first.release();
    const second = await acquireCaptureLock(dir);
    await second.release();
  });

  it("reports an existing lock holder", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-lock-"));
    await writeStaleLockForTests(dir, "pid=999\nstartedAt=test\n");
    await assert.rejects(() => acquireCaptureLock(dir), /pid=999/);
  });
});
