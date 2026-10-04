import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  clearManagedCaptureOutputs,
  stageCurrentRunArtifact,
} from "../capture/output.ts";

function manifestWithFiles(files: string[]): string {
  return `${JSON.stringify(
    {
      capturedAt: "2026-01-01T00:00:00.000Z",
      baseUrl: "http://example.test",
      appCommitSha: null,
      appCommitShaVerified: false,
      outputDir: "/tmp",
      viewports: [],
      routes: [],
      results: files.map((file) => ({
        screenId: "home",
        path: "/",
        viewportId: "desktop",
        width: 1440,
        height: 900,
        file,
        status: "ok",
        error: null,
      })),
      summary: { total: files.length, ok: files.length, failed: 0 },
    },
    null,
    2,
  )}\n`;
}

describe("clearManagedCaptureOutputs", () => {
  it("deletes only files recorded in the previous manifest", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-out-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "desktop-1440x900.png"), "managed");
    await writeFile(path.join(dir, "home", "keep-unrelated.png"), "unrelated");
    await writeFile(path.join(dir, "notes.txt"), "keep me");
    await writeFile(path.join(dir, ".capture.lock"), "pid=1\n");
    await writeFile(
      path.join(dir, "manifest.json"),
      manifestWithFiles(["home/desktop-1440x900.png"]),
    );

    await clearManagedCaptureOutputs(dir);

    await assert.rejects(() => access(path.join(dir, "home", "desktop-1440x900.png")));
    await assert.rejects(() => access(path.join(dir, "manifest.json")));
    await access(path.join(dir, "home", "keep-unrelated.png"));
    await access(path.join(dir, "notes.txt"));
    await access(path.join(dir, ".capture.lock"));
  });

  it("deletes nothing when the previous manifest is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-missing-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "desktop-1440x900.png"), "png");

    await clearManagedCaptureOutputs(dir);

    await access(path.join(dir, "home", "desktop-1440x900.png"));
  });

  it("deletes nothing when the previous manifest is invalid", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-invalid-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "desktop-1440x900.png"), "png");
    await writeFile(path.join(dir, "manifest.json"), "{not-json");

    await clearManagedCaptureOutputs(dir);

    await access(path.join(dir, "home", "desktop-1440x900.png"));
    await access(path.join(dir, "manifest.json"));
  });

  it("preserves unrelated PNGs that are not listed in the previous manifest", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-unrelated-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "listed.png"), "listed");
    await writeFile(path.join(dir, "home", "unrelated.png"), "keep");
    await writeFile(
      path.join(dir, "manifest.json"),
      manifestWithFiles(["home/listed.png"]),
    );

    await clearManagedCaptureOutputs(dir);

    await assert.rejects(() => access(path.join(dir, "home", "listed.png")));
    assert.equal(
      await readFile(path.join(dir, "home", "unrelated.png"), "utf8"),
      "keep",
    );
  });

  it("rejects absolute manifest paths and leaves local files untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-abs-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "keep.png"), "keep");
    await writeFile(
      path.join(dir, "manifest.json"),
      manifestWithFiles(["/tmp/absolute.png"]),
    );

    await clearManagedCaptureOutputs(dir);

    await access(path.join(dir, "home", "keep.png"));
  });

  it("rejects traversal paths from the manifest and leaves local files untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-travel-"));
    await mkdir(path.join(dir, "home"), { recursive: true });
    await writeFile(path.join(dir, "home", "keep.png"), "keep");
    await writeFile(
      path.join(dir, "manifest.json"),
      manifestWithFiles(["../escape.png"]),
    );

    await clearManagedCaptureOutputs(dir);

    await access(path.join(dir, "home", "keep.png"));
    // Unsafe manifest paths are skipped (no PNG sweep). The previous manifest is
    // still removed after a successful parse so the next run can replace it.
    await assert.rejects(() => access(path.join(dir, "manifest.json")));
  });

  it("rejects symlink escapes from the manifest and leaves them untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "capture-link-"));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "capture-link-out-"));
    const outsideFile = path.join(outsideDir, "secret.png");
    await writeFile(outsideFile, "secret");
    await mkdir(path.join(dir, "home"), { recursive: true });
    const linkPath = path.join(dir, "home", "escape.png");
    await symlink(outsideFile, linkPath);
    await writeFile(
      path.join(dir, "manifest.json"),
      manifestWithFiles(["home/escape.png"]),
    );

    await clearManagedCaptureOutputs(dir);

    await access(linkPath);
    await access(outsideFile);
    assert.equal(await readFile(outsideFile, "utf8"), "secret");
  });
});

describe("stageCurrentRunArtifact", () => {
  it("stages only the current run manifest and ok screenshot files", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "capture-stage-out-"));
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "capture-stage-art-"));
    await mkdir(path.join(outputDir, "home"), { recursive: true });
    await writeFile(path.join(outputDir, "home", "desktop-1440x900.png"), "shot");
    await writeFile(path.join(outputDir, "home", "unrelated.png"), "nope");
    await writeFile(
      path.join(outputDir, "manifest.json"),
      manifestWithFiles(["home/desktop-1440x900.png"]),
    );

    await writeFile(path.join(artifactDir, "leftover.txt"), "old");

    const staged = await stageCurrentRunArtifact(outputDir, artifactDir);
    assert.deepEqual(staged.sort(), ["home/desktop-1440x900.png", "manifest.json"].sort());
    await access(path.join(artifactDir, "manifest.json"));
    await access(path.join(artifactDir, "home", "desktop-1440x900.png"));
    await assert.rejects(() => access(path.join(artifactDir, "home", "unrelated.png")));
    await assert.rejects(() => access(path.join(artifactDir, "leftover.txt")));
  });
});
