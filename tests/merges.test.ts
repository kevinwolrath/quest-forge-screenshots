import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStoredZip } from "../src/archive.ts";
import { handleRequest, type GalleryBindings } from "../src/gallery.ts";
import {
  CURRENT_ARCHIVE_KEY,
  LEGACY_ARCHIVE_KEY,
  MERGE_HISTORY_LIMIT,
  snapshotArchiveKey,
  snapshotManifestKey,
} from "../src/limits.ts";
import { GENERATED_AT, PNG, galleryZip } from "./gallery-fixtures.ts";
import { MemoryBucket } from "./memory-bucket.ts";

/** Merge history (QUE-147): develop/ plus the newest ten merges/<id>/ folders. */

const SECRET = "test-publish-secret-value";
const TOKEN = "test-access-token";
const allow = { verifyAccess: async (jwt: string) => jwt === TOKEN };

function commit(n: number): string {
  return n.toString(16).padStart(12, "0") + "a".repeat(28);
}

function mergeId(n: number): string {
  return `pr-${n}-${commit(n).slice(0, 12)}`;
}

/** Merge n happened n minutes after 09:00 (so a larger n is newer). */
function mergeZip(n: number, mergedAt = new Date(Date.UTC(2026, 9, 8, 9, n)).toISOString()): Uint8Array {
  const manifest = {
    generatedAt: GENERATED_AT,
    snapshot: {
      id: mergeId(n),
      kind: "merge",
      pr: { number: n, title: `Change ${n}` },
      mergeCommit: commit(n),
      mergedAt,
      screens: ["c03-characters"],
      viewports: ["desktop"],
    },
    images: [{ file: "images/c03-characters-desktop.png", screen: "c03-characters", viewport: "desktop 1440x900" }],
  };
  return buildStoredZip([
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
    { name: "images/c03-characters-desktop.png", data: PNG },
  ]);
}

function bindings(bucket: MemoryBucket): GalleryBindings {
  return { SCREENSHOTS: bucket, PUBLISH_SECRET: SECRET };
}

function post(pathname: string, body: Uint8Array): Request {
  return new Request(`https://gallery.test${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/zip" },
    body: Buffer.from(body),
  });
}

const publishMerge = (bucket: MemoryBucket, n: number, body = mergeZip(n)) =>
  handleRequest(post(`/publish/snapshots/${mergeId(n)}`, body), bindings(bucket));

const viewer = (bucket: MemoryBucket, pathname: string, signedIn = true) =>
  handleRequest(
    new Request(`https://gallery.test${pathname}`, signedIn ? { headers: { "cf-access-jwt-assertion": TOKEN } } : {}),
    bindings(bucket),
    allow,
  );

function folders(bucket: MemoryBucket): string[] {
  return [...new Set([...bucket.objects.keys()].filter((key) => key.startsWith("merges/")).map((key) => key.split("/")[1]!))].sort();
}

async function listed(bucket: MemoryBucket): Promise<{ id: string; pr: { number: number; title: string }; mergedAt: string; screens: string[] }[]> {
  const response = await viewer(bucket, "/api/merges");
  assert.equal(response.status, 200);
  return ((await response.json()) as { merges: [] }).merges;
}

describe("develop gallery", () => {
  it("a develop publish writes only develop/archive.zip", async () => {
    const bucket = new MemoryBucket();
    assert.equal((await publishMerge(bucket, 1)).status, 200);
    const before = new Map(bucket.objects);
    const response = await handleRequest(post("/publish", galleryZip()), bindings(bucket));
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { archive: string }).archive, "develop/archive.zip");
    assert.equal(CURRENT_ARCHIVE_KEY, "develop/archive.zip");
    for (const [key, value] of before) assert.deepEqual(bucket.objects.get(key), value);
    assert.deepEqual([...bucket.objects.keys()].filter((key) => !before.has(key)), [CURRENT_ARCHIVE_KEY]);
  });

  it("serves the develop archive, and the legacy archive until develop/ is published", async () => {
    const bucket = new MemoryBucket();
    const legacy = galleryZip();
    bucket.objects.set(LEGACY_ARCHIVE_KEY, legacy);
    const first = await viewer(bucket, "/archive");
    assert.equal(first.status, 200);
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), legacy);

    const current = galleryZip([{ file: "images/home-mobile.png", screen: "home", viewport: "mobile", bytes: PNG }]);
    bucket.objects.set(CURRENT_ARCHIVE_KEY, current);
    assert.deepEqual(new Uint8Array(await (await viewer(bucket, "/archive")).arrayBuffer()), current);
  });
});

describe("merge folders and retention", () => {
  it("stores the archive and its summary in the merge's own folder, once per merge", async () => {
    const bucket = new MemoryBucket();
    const response = await publishMerge(bucket, 7);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { archive: string; pruned: string[]; retention: string };
    assert.equal(body.archive, `merges/${mergeId(7)}/archive.zip`);
    assert.deepEqual(body.pruned, []);
    assert.equal(body.retention, "complete");
    assert.deepEqual([...bucket.objects.keys()].sort(), [snapshotArchiveKey(mergeId(7)), snapshotManifestKey(mergeId(7))]);

    assert.equal((await publishMerge(bucket, 7)).status, 200);
    assert.deepEqual(folders(bucket), [mergeId(7)]);
    const merges = await listed(bucket);
    assert.equal(merges.length, 1);
    assert.deepEqual(merges[0], {
      id: mergeId(7),
      kind: "merge",
      pr: { number: 7, title: "Change 7" },
      mergeCommit: commit(7),
      mergedAt: "2026-10-08T09:07:00.000Z",
      screens: ["c03-characters"],
      viewports: ["desktop"],
      generatedAt: GENERATED_AT,
      images: 1,
    });
  });

  it("publishing the 11th distinct merge removes the oldest and leaves develop alone", async () => {
    const bucket = new MemoryBucket();
    const develop = galleryZip();
    bucket.objects.set(CURRENT_ARCHIVE_KEY, develop);
    // Published out of merge order: retention follows merge time, not upload order.
    for (const n of [3, 1, 2, 4, 5, 6, 7, 8, 9, 10]) assert.equal((await publishMerge(bucket, n)).status, 200);
    assert.equal(folders(bucket).length, MERGE_HISTORY_LIMIT);

    const response = await publishMerge(bucket, 11);
    assert.deepEqual(((await response.json()) as { pruned: string[] }).pruned, [mergeId(1)]);
    assert.deepEqual(folders(bucket), Array.from({ length: 10 }, (_, index) => mergeId(index + 2)).sort());
    assert.deepEqual(bucket.objects.get(CURRENT_ARCHIVE_KEY), develop);
    assert.deepEqual(
      (await listed(bucket)).map((merge) => merge.pr.number),
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    );

    // A late retry of a merge older than the newest ten is stored, then pruned again.
    const late = await publishMerge(bucket, 1);
    assert.equal(late.status, 200);
    assert.deepEqual(((await late.json()) as { pruned: string[] }).pruned, [mergeId(1)]);
    assert.equal(folders(bucket).includes(mergeId(1)), false);
  });

  it("refused, failed and half-written uploads never prune history", async () => {
    const bucket = new MemoryBucket();
    for (let n = 1; n <= 10; n += 1) await publishMerge(bucket, n);
    const before = new Map(bucket.objects);

    const invalid = await publishMerge(bucket, 11, galleryZip());
    assert.equal(invalid.status, 400);
    bucket.failPut = true;
    assert.equal((await publishMerge(bucket, 11)).status, 503);
    bucket.failPut = false;
    // The archive is written but its summary is not: the publish fails and nothing is pruned.
    bucket.failPutKey = /manifest\.json$/;
    assert.equal((await publishMerge(bucket, 11)).status, 503);
    bucket.failPutKey = null;

    assert.deepEqual(bucket.deletes, []);
    for (const [key, value] of before) assert.deepEqual(bucket.objects.get(key), value);
    // The half-written folder is not listed.
    assert.equal((await listed(bucket)).some((merge) => merge.id === mergeId(11)), false);

    // The retry succeeds, replaces its own folder, and only then prunes the oldest merge.
    const retry = await publishMerge(bucket, 11);
    assert.equal(retry.status, 200);
    assert.deepEqual(((await retry.json()) as { pruned: string[] }).pruned, [mergeId(1)]);
    assert.equal(folders(bucket).length, MERGE_HISTORY_LIMIT);
  });

  it("keeps a stored merge when pruning fails, and says retention is incomplete", async () => {
    const bucket = new MemoryBucket();
    for (let n = 1; n <= 10; n += 1) await publishMerge(bucket, n);
    bucket.failDelete = true;
    const response = await publishMerge(bucket, 11);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { retention: string }).retention, "incomplete");
    assert.equal(folders(bucket).length, 11);
    // The list still offers only the newest ten; the next publish catches up.
    assert.deepEqual((await listed(bucket)).map((merge) => merge.pr.number)[9], 2);
    bucket.failDelete = false;
    await publishMerge(bucket, 12);
    assert.equal(folders(bucket).length, MERGE_HISTORY_LIMIT);
  });

  it("removes a folder left without a readable summary, but never the merge just stored", async () => {
    const bucket = new MemoryBucket();
    bucket.objects.set(snapshotArchiveKey(mergeId(2)), mergeZip(2));
    bucket.objects.set(snapshotManifestKey(mergeId(3)), new TextEncoder().encode("{not json"));
    bucket.objects.set("merges/stray/archive.zip", mergeZip(4));
    const response = await publishMerge(bucket, 5);
    assert.deepEqual(((await response.json()) as { pruned: string[] }).pruned.sort(), [mergeId(2), mergeId(3), "stray"].sort());
    assert.deepEqual(folders(bucket), [mergeId(5)]);
  });
});

describe("merge list", () => {
  it("requires Cloudflare Access and never the upload secret", async () => {
    const bucket = new MemoryBucket();
    await publishMerge(bucket, 1);
    bucket.gets.length = 0;
    assert.equal((await viewer(bucket, "/api/merges", false)).status, 403);
    const bearer = await handleRequest(
      new Request("https://gallery.test/api/merges", { headers: { authorization: `Bearer ${SECRET}` } }),
      bindings(bucket),
      allow,
    );
    assert.equal(bearer.status, 403);
    assert.deepEqual(bucket.gets, []);
    assert.equal((await viewer(bucket, `/merges/${mergeId(1)}/archive`, false)).status, 403);
  });

  it("lists the newest merges with their PR details and screens, and loads one", async () => {
    const bucket = new MemoryBucket();
    for (const n of [1, 2]) await publishMerge(bucket, n);
    const merges = await listed(bucket);
    assert.deepEqual(
      merges.map((merge) => [merge.id, merge.pr.title, merge.screens]),
      [
        [mergeId(2), "Change 2", ["c03-characters"]],
        [mergeId(1), "Change 1", ["c03-characters"]],
      ],
    );
    const archive = await viewer(bucket, `/merges/${mergeId(2)}/archive`);
    assert.equal(archive.status, 200);
    assert.deepEqual(new Uint8Array(await archive.arrayBuffer()), mergeZip(2));

    const empty = await listed(new MemoryBucket());
    assert.deepEqual(empty, []);
  });

  it("reports an unreadable bucket instead of an empty history", async () => {
    const bucket = new MemoryBucket();
    bucket.failList = true;
    const response = await viewer(bucket, "/api/merges");
    assert.equal(response.status, 503);
  });
});
