import { readFile, stat } from "node:fs/promises";

import { ArchiveRejection, validateGalleryZip } from "../src/archive.ts";
import { LIMITS } from "../src/limits.ts";

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const secret = process.env.GALLERY_PUBLISH_SECRET ?? "";
  const rawUrl = process.env.GALLERY_PUBLISH_URL?.trim() ?? "";
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    fail("Usage: npm run publish:archive -- <gallery.zip>");
  }
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    fail("GALLERY_PUBLISH_URL must be an http(s) URL with path /publish.");
  }
  if (
    (target.protocol !== "https:" && target.protocol !== "http:") ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/publish"
  ) {
    fail("GALLERY_PUBLISH_URL must be an http(s) URL with path /publish and no credentials.");
  }
  if (!secret) fail("GALLERY_PUBLISH_SECRET is required.");

  const info = await stat(file);
  if (info.size > LIMITS.maxZipBytes) fail("archive rejected: too_large");
  const bytes = new Uint8Array(await readFile(file));
  try {
    await validateGalleryZip(bytes);
  } catch (error) {
    const code = error instanceof ArchiveRejection ? error.code : "malformed";
    fail(`archive rejected: ${code}`);
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/zip",
      },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    fail(redact(`publish failed: ${message}`, secret));
  }

  const raw = await response.text();
  if (!response.ok) {
    let code = "";
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && /^[a-z0-9_]+$/.test(parsed.error)) code = parsed.error;
    } catch {
      code = "";
    }
    fail(redact(code ? `publish rejected: ${code}` : `publish failed: HTTP ${response.status}`, secret));
  }
  console.log(redact(raw, secret));
}

main().catch((error: unknown) => {
  const secret = process.env.GALLERY_PUBLISH_SECRET ?? "";
  const message = error instanceof Error ? error.message : "publish failed";
  console.error(redact(message, secret));
  process.exitCode = 1;
});
