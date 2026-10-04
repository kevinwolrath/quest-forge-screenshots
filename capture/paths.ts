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
