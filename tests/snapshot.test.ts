import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ArchiveRejection, buildStoredZip, validateGalleryZip, validateSnapshotZip } from "../src/archive.ts";
import { handleRequest, type GalleryBindings } from "../src/gallery.ts";
import { CURRENT_ARCHIVE_KEY, snapshotArchiveKey } from "../src/limits.ts";
import { GENERATED_AT, JPEG, PNG, galleryZip } from "./gallery-fixtures.ts";
import { MemoryBucket } from "./memory-bucket.ts";

const SECRET = "test-publish-secret-value";
const TOKEN = "test-access-token";
const COMMIT = "696eb12abcdef0123456789abcdef0123456789a";
const ID = "pr-278-696eb12abcde";
const root = path.resolve(import.meta.dirname, "..");

type Image = { file: string; screen: string; viewport: string; bytes: Uint8Array };

const IMAGES: Image[] = [
  { file: "images/c03-characters-desktop.png", screen: "c03-characters", viewport: "desktop 1440x900", bytes: PNG },
  { file: "images/c03-characters-mobile.png", screen: "c03-characters", viewport: "mobile 390x844", bytes: PNG },
  { file: "images/t-tavern-home-desktop.jpg", screen: "t-tavern-home", viewport: "desktop 1440x900", bytes: JPEG },
  { file: "images/t-tavern-home-mobile.jpg", screen: "t-tavern-home", viewport: "mobile 390x844", bytes: JPEG },
];

function snapshotBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    kind: "merge",
    pr: { number: 278, title: "Show character portraits" },
    mergeCommit: COMMIT,
    mergedAt: "2026-10-08T09:00:00Z",
    screens: ["c03-characters", "t-tavern-home"],
    viewports: ["desktop", "mobile"],
    ...overrides,
  };
}

function snapshotZip(snapshot: unknown = snapshotBlock(), images: Image[] = IMAGES): Uint8Array {
  const manifest = {
    generatedAt: GENERATED_AT,
    snapshot,
    images: images.map(({ file, screen, viewport }) => ({ file, screen, viewport })),
  };
  return buildStoredZip([
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...images.map((image) => ({ name: image.file, data: image.bytes })),
  ]);
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ArchiveRejection);
    return error.code;
  }
  assert.fail("expected a rejection");
}

function bindings(bucket: MemoryBucket): GalleryBindings {
  return { SCREENSHOTS: bucket, PUBLISH_SECRET: SECRET };
}

function post(pathname: string, body: Uint8Array, secret = SECRET): Request {
  return new Request(`https://gallery.test${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/zip" },
    body: Buffer.from(body),
  });
}

describe("merge snapshot validation", () => {
  it("accepts a snapshot and returns its merge labels", async () => {
    const validated = await validateSnapshotZip(snapshotZip());
    assert.deepEqual(validated.snapshot, snapshotBlock());
    assert.deepEqual(
      validated.images.map((image) => image.file),
      IMAGES.map((image) => image.file),
    );
  });

  it("keeps the current archive free of snapshot metadata", async () => {
    assert.equal(await rejection(validateGalleryZip(snapshotZip())), "bad_manifest");
    assert.equal(await rejection(validateSnapshotZip(galleryZip())), "bad_manifest");
  });

  it("rejects an id that is not derived from the PR and merge commit", async () => {
    const cases: Record<string, unknown>[] = [
      { id: "pr-279-696eb12abcde" },
      { id: "pr-278-000000000000" },
      { id: "../current-screenshots" },
      { mergeCommit: "696eb12" },
      { pr: { number: 0, title: "x" }, id: "pr-0-696eb12abcde" },
      { pr: { number: 278, title: "x", body: "extra" } },
      { pr: { number: 278, title: "" } },
      { pr: { number: 278, title: "Line\nbreak" } },
      { pr: { number: 278, title: "x".repeat(201) } },
      { pr: { number: 278, title: " padded" } },
      { kind: "develop" },
      { mergedAt: "yesterday" },
      { extra: true },
    ];
    for (const overrides of cases) {
      assert.equal(await rejection(validateSnapshotZip(snapshotZip(snapshotBlock(overrides)))), "bad_manifest", JSON.stringify(overrides));
    }
  });

  it("requires the screens and viewports to match the images exactly", async () => {
    const cases: Record<string, unknown>[] = [
      { screens: ["c03-characters"] },
      { screens: ["c03-characters", "t-tavern-home", "c01-sign-in"] },
      { screens: ["c03-characters", "c03-characters", "t-tavern-home"] },
      { screens: ["C03 Characters", "t-tavern-home"] },
      { viewports: ["desktop"] },
      { viewports: ["desktop", "mobile", "tablet"] },
      { viewports: [] },
    ];
    for (const overrides of cases) {
      assert.equal(await rejection(validateSnapshotZip(snapshotZip(snapshotBlock(overrides)))), "bad_manifest", JSON.stringify(overrides));
    }
    assert.equal(await rejection(validateSnapshotZip(snapshotZip(snapshotBlock(), []))), "bad_manifest");
  });
});

describe("merge snapshot publishing", () => {
  it("stores a snapshot beside the current archive and replaces it on retry", async () => {
    const bucket = new MemoryBucket();
    const current = galleryZip();
    bucket.objects.set(CURRENT_ARCHIVE_KEY, current);
    const first = snapshotZip();
    const response = await handleRequest(post(`/publish/snapshots/${ID}`, first), bindings(bucket));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { archive: string; snapshot: string; images: string[] };
    assert.equal(body.archive, `snapshots/${ID}.zip`);
    assert.equal(body.snapshot, ID);
    assert.equal(body.images.length, IMAGES.length);
    assert.equal(JSON.stringify(body).includes(SECRET), false);

    const retry = snapshotZip(snapshotBlock(), IMAGES.slice(0, 2).concat(IMAGES.slice(2)));
    assert.equal((await handleRequest(post(`/publish/snapshots/${ID}`, retry), bindings(bucket))).status, 200);
    assert.deepEqual([...bucket.objects.keys()].sort(), [CURRENT_ARCHIVE_KEY, snapshotArchiveKey(ID)]);
    assert.deepEqual(bucket.objects.get(CURRENT_ARCHIVE_KEY), current);
  });

  it("leaves stored archives untouched when a snapshot is refused or not written", async () => {
    const bucket = new MemoryBucket();
    const stored = snapshotZip();
    bucket.objects.set(snapshotArchiveKey(ID), stored);
    const other = snapshotZip(snapshotBlock({ id: "pr-279-696eb12abcde", pr: { number: 279, title: "Other" } }));

    const mismatched = await handleRequest(post(`/publish/snapshots/${ID}`, other), bindings(bucket));
    assert.equal(mismatched.status, 400);
    assert.equal(((await mismatched.json()) as { error: string }).error, "bad_manifest");

    const plain = await handleRequest(post(`/publish/snapshots/${ID}`, galleryZip()), bindings(bucket));
    assert.equal(plain.status, 400);

    const unauthorized = await handleRequest(post(`/publish/snapshots/${ID}`, stored, "wrong-secret-value"), bindings(bucket));
    assert.equal(unauthorized.status, 401);

    const badId = await handleRequest(post("/publish/snapshots/current-screenshots", stored), bindings(bucket));
    assert.equal(badId.status, 404);

    bucket.failPut = true;
    const failed = await handleRequest(post(`/publish/snapshots/${ID}`, stored), bindings(bucket));
    assert.equal(failed.status, 503);
    bucket.failPut = false;

    assert.deepEqual(bucket.puts, [snapshotArchiveKey(ID)]);
    assert.deepEqual(bucket.objects.get(snapshotArchiveKey(ID)), stored);
    assert.equal(bucket.objects.has(CURRENT_ARCHIVE_KEY), false);
  });

  it("serves a snapshot only to a signed-in viewer", async () => {
    const bucket = new MemoryBucket();
    const stored = snapshotZip();
    bucket.objects.set(snapshotArchiveKey(ID), stored);
    const allow = { verifyAccess: async (jwt: string) => jwt === TOKEN };

    const anonymous = await handleRequest(new Request(`https://gallery.test/snapshots/${ID}`), bindings(bucket), allow);
    assert.equal(anonymous.status, 403);
    const bearer = await handleRequest(
      new Request(`https://gallery.test/snapshots/${ID}`, { headers: { authorization: `Bearer ${SECRET}` } }),
      bindings(bucket),
      allow,
    );
    assert.equal(bearer.status, 403);
    assert.deepEqual(bucket.gets, []);

    const viewer = (pathname: string) =>
      handleRequest(new Request(`https://gallery.test${pathname}`, { headers: { "cf-access-jwt-assertion": TOKEN } }), bindings(bucket), allow);
    const found = await viewer(`/snapshots/${ID}`);
    assert.equal(found.status, 200);
    assert.equal(found.headers.get("content-type"), "application/zip");
    assert.deepEqual(new Uint8Array(await found.arrayBuffer()), stored);
    assert.equal((await viewer("/snapshots/pr-1-000000000000")).status, 404);
    assert.equal((await viewer("/snapshots/..%2Fcurrent-screenshots")).status, 404);
  });
});

describe("publish:snapshot", () => {
  it("posts a validated snapshot to its merge route", async () => {
    const bucket = new MemoryBucket();
    const paths: string[] = [];
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      paths.push(req.url ?? "");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handleRequest(
        new Request(`http://127.0.0.1${req.url ?? "/"}`, {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: Buffer.concat(chunks),
        }),
        bindings(bucket),
      );
      res.statusCode = response.status;
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    const dir = await mkdtemp(path.join(os.tmpdir(), "gallery-snapshot-"));
    const good = path.join(dir, "snapshot.zip");
    const plain = path.join(dir, "gallery.zip");
    await writeFile(good, snapshotZip());
    await writeFile(plain, galleryZip());
    const run = (args: string[]) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", path.join(root, "publisher/cli.ts"), ...args], {
          cwd: root,
          env: { ...process.env, GALLERY_PUBLISH_URL: `http://127.0.0.1:${address.port}/publish`, GALLERY_PUBLISH_SECRET: SECRET },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (status) => resolve({ status, stdout, stderr }));
      });
    try {
      const ok = await run(["--snapshot", good]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, new RegExp(`snapshots/${ID}\\.zip`));
      assert.equal(ok.stdout.includes(SECRET), false);
      assert.deepEqual(paths, [`/publish/snapshots/${ID}`]);
      assert.equal(bucket.objects.has(snapshotArchiveKey(ID)), true);

      const refused = await run(["--snapshot", plain]);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /archive rejected: bad_manifest/);
      assert.equal(paths.length, 1);

      const usage = await run(["--snapshot"]);
      assert.notEqual(usage.status, 0);
      assert.match(usage.stderr, /publish:snapshot/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
