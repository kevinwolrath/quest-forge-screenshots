import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { handleRequest } from "../src/gallery.ts";
import { CURRENT_ARCHIVE_KEY } from "../src/limits.ts";
import { galleryZip } from "./gallery-fixtures.ts";
import { MemoryBucket } from "./memory-bucket.ts";

const SECRET = "super-secret-publish-value";
const root = path.resolve(import.meta.dirname, "..");

async function serve(bucket: MemoryBucket): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await handleRequest(request, {
      SCREENSHOTS: bucket,
      PUBLISH_SECRET: SECRET,
    });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return {
    url: `http://127.0.0.1:${address.port}/publish`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.join(root, "publisher/cli.ts"), ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("publish:archive", () => {
  it("uploads one validated zip and never prints the secret", async () => {
    const bucket = new MemoryBucket();
    const server = await serve(bucket);
    const dir = await mkdtemp(path.join(os.tmpdir(), "gallery-publish-"));
    const zipPath = path.join(dir, "gallery.zip");
    const badPath = path.join(dir, "bad.zip");
    await writeFile(zipPath, galleryZip());
    await writeFile(badPath, galleryZip(undefined, { outputDir: "/tmp/captures" }));
    try {
      const ok = await runCli([zipPath], {
        GALLERY_PUBLISH_URL: server.url,
        GALLERY_PUBLISH_SECRET: SECRET,
      });
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout.includes(SECRET), false);
      assert.equal(ok.stderr.includes(SECRET), false);
      assert.match(ok.stdout, /develop\/archive\.zip/);
      assert.equal(bucket.objects.has(CURRENT_ARCHIVE_KEY), true);

      const bad = await runCli([badPath], {
        GALLERY_PUBLISH_URL: server.url,
        GALLERY_PUBLISH_SECRET: SECRET,
      });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /bad_manifest/);
      assert.equal(bad.stdout.includes(SECRET), false);
      assert.equal(bad.stderr.includes(SECRET), false);
      assert.equal(bucket.puts.length, 1);

      const wrong = await runCli([zipPath], {
        GALLERY_PUBLISH_URL: server.url,
        GALLERY_PUBLISH_SECRET: "different-secret-value",
      });
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /HTTP 401/);
      assert.equal(wrong.stderr.includes(SECRET), false);
      assert.equal(wrong.stderr.includes("different-secret-value"), false);
      assert.equal(bucket.puts.length, 1);

      const credentials = await runCli([zipPath], {
        GALLERY_PUBLISH_URL: "http://user:password@127.0.0.1/publish",
        GALLERY_PUBLISH_SECRET: SECRET,
      });
      assert.notEqual(credentials.status, 0);
      assert.match(credentials.stderr, /no credentials/);
      assert.equal(credentials.stderr.includes(SECRET), false);
    } finally {
      await server.close();
    }
  });
});
