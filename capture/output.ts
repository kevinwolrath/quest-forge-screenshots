import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const LOCK_NAME = ".capture.lock";

/**
 * Remove managed capture artifacts from a previous run under the output lock.
 * Preserves `.capture.lock` and unrelated non-PNG files.
 */
export async function clearManagedCaptureOutputs(outputDir: string): Promise<void> {
  const root = path.resolve(outputDir);
  await rm(path.join(root, "manifest.json"), { force: true });
  await removeManagedPngs(root);
}

async function removeManagedPngs(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (entry.name === LOCK_NAME) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeManagedPngs(fullPath);
      const remaining = await readdir(fullPath);
      if (remaining.length === 0) {
        await rm(fullPath, { recursive: true, force: true });
      }
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      await rm(fullPath, { force: true });
    }
  }
}
