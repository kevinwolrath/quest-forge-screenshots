import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveManagedOutputPath, resolveSafeDeletePath } from "./paths.ts";
import type { RunManifest } from "./types.ts";

function isRunManifest(value: unknown): value is RunManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const manifest = value as RunManifest;
  return Array.isArray(manifest.results);
}

/**
 * Remove only files recorded as generated captures in the previous manifest.
 * If the previous manifest is missing or invalid, delete nothing (no PNG wipe).
 * Rejects absolute paths, traversal, and symlink escapes before any delete.
 */
export async function clearManagedCaptureOutputs(outputDir: string): Promise<void> {
  const root = path.resolve(outputDir);
  const manifestPath = path.join(root, "manifest.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }

  if (!isRunManifest(parsed)) {
    return;
  }

  for (const result of parsed.results) {
    if (!result || typeof result.file !== "string" || !result.file) {
      continue;
    }
    let absoluteFile: string | null;
    try {
      absoluteFile = await resolveSafeDeletePath(root, result.file);
    } catch {
      // Reject unsafe paths; do not delete them and do not fall back to wiping PNGs.
      continue;
    }
    if (absoluteFile) {
      await rm(absoluteFile, { force: true });
    }
  }

  await rm(manifestPath, { force: true });
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }
  return String((error as { code: unknown }).code);
}

/**
 * Replace artifact contents. A normal directory is removed and recreated.
 * A bind mount cannot be removed (EBUSY/EPERM); its entries are cleared so
 * unrelated files still cannot remain in the uploaded artifact.
 */
async function resetArtifactDirectory(stagingRoot: string): Promise<void> {
  await mkdir(stagingRoot, { recursive: true });
  try {
    await rm(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") {
      throw error;
    }
    const entries = await readdir(stagingRoot);
    await Promise.all(
      entries.map((entry) =>
        rm(path.join(stagingRoot, entry), { recursive: true, force: true }),
      ),
    );
  }
  await mkdir(stagingRoot, { recursive: true });
}

/**
 * Copy only this run's manifest and generated screenshot files into artifactDir
 * so uploads cannot include unrelated files left in the output directory.
 */
export async function stageCurrentRunArtifact(
  outputDir: string,
  artifactDir: string,
): Promise<string[]> {
  const root = path.resolve(outputDir);
  const stagingRoot = path.resolve(artifactDir);
  const manifestPath = path.join(root, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRunManifest(parsed)) {
    throw new Error("current manifest.json is missing or invalid; cannot stage artifact");
  }

  await resetArtifactDirectory(stagingRoot);

  const staged: string[] = ["manifest.json"];
  await writeFile(path.join(stagingRoot, "manifest.json"), raw, "utf8");

  for (const result of parsed.results) {
    if (!result || result.status !== "ok" || typeof result.file !== "string" || !result.file) {
      continue;
    }
    const source = resolveManagedOutputPath(root, result.file);
    const destination = resolveManagedOutputPath(stagingRoot, result.file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    staged.push(result.file);
  }

  return staged;
}
