import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Resolve a relative capture file under outputDir, rejecting path escapes.
 */
export function resolveManagedOutputPath(
  outputDir: string,
  relativeFile: string,
): string {
  if (!relativeFile || path.isAbsolute(relativeFile)) {
    throw new Error("screenshot path must be a non-empty relative path");
  }

  const posixRel = relativeFile.split(path.win32.sep).join(path.posix.sep);
  if (
    posixRel.startsWith("/") ||
    posixRel.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(
      "screenshot path must not escape the output directory or contain empty/'.'/'..' segments",
    );
  }

  const root = path.resolve(outputDir);
  const absoluteFile = path.resolve(root, ...posixRel.split("/"));
  const relativeToRoot = path.relative(root, absoluteFile);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("screenshot path escapes the configured output directory");
  }

  return absoluteFile;
}

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const relativeToRoot = path.relative(rootReal, candidateReal);
  return (
    relativeToRoot === "" ||
    (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))
  );
}

/**
 * Resolve a path that is safe to delete under outputDir.
 * Rejects absolute paths, traversal, and symlink escapes.
 * Returns null when the target does not exist.
 */
export async function resolveSafeDeletePath(
  outputDir: string,
  relativeFile: string,
): Promise<string | null> {
  const absoluteFile = resolveManagedOutputPath(outputDir, relativeFile);
  const root = path.resolve(outputDir);
  const rootReal = await realpath(root);

  let stats;
  try {
    stats = await lstat(absoluteFile);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    const targetReal = await realpath(absoluteFile);
    if (!isInsideRoot(rootReal, targetReal)) {
      throw new Error("screenshot path symlink escapes the output directory");
    }
    return absoluteFile;
  }

  if (!stats.isFile()) {
    throw new Error("screenshot path must refer to a regular file");
  }

  // Ensure no parent symlink escapes the output root.
  const parentReal = await realpath(path.dirname(absoluteFile));
  if (!isInsideRoot(rootReal, parentReal)) {
    throw new Error("screenshot path parent escapes the output directory");
  }

  return absoluteFile;
}
