import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export type CaptureLock = {
  release: () => Promise<void>;
};

/**
 * Exclusive lock so concurrent local or CI capture processes do not write the
 * same output directory at once. Does not start, stop, or alter any application.
 */
export async function acquireCaptureLock(outputDir: string): Promise<CaptureLock> {
  await mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, ".capture.lock");
  let handle: FileHandle;

  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "EEXIST") {
      let holder = "unknown";
      try {
        holder = (await readFile(lockPath, "utf8")).trim() || holder;
      } catch {
        // Ignore read failures; the lock still exists.
      }
      throw new Error(
        `Another screenshot capture holds the lock at ${lockPath} (holder: ${holder}). Wait for it to finish or remove a stale lock only if no capture is running.`,
      );
    }
    throw error;
  }

  const payload = `pid=${process.pid}\nstartedAt=${new Date().toISOString()}\n`;
  await handle.writeFile(payload, "utf8");

  let released = false;
  return {
    async release() {
      if (released) {
        return;
      }
      released = true;
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true });
    },
  };
}

/** Test helper: write a lock file without opening a handle. */
export async function writeStaleLockForTests(
  outputDir: string,
  contents: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, ".capture.lock");
  await writeFile(lockPath, contents, "utf8");
  return lockPath;
}
