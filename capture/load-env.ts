import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Optionally load KEY=VALUE pairs from a local .env into process.env.
 * Existing environment variables win. Missing file is a no-op.
 * Does not print values.
 */
export async function loadEnvFile(
  filePath: string = path.resolve(process.cwd(), ".env"),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return true;
}
