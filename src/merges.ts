import type { SnapshotInfo } from "./archive.ts";
import {
  MERGES_PREFIX,
  MERGE_HISTORY_LIMIT,
  SNAPSHOT_ID,
  snapshotArchiveKey,
  snapshotManifestKey,
} from "./limits.ts";

/**
 * Merge history in private R2 (QUE-147). Each merge snapshot is a folder,
 * `merges/<id>/`, holding `archive.zip` and `manifest.json`. The manifest is
 * the merge's metadata, so listing never opens an archive. Only the newest
 * MERGE_HISTORY_LIMIT merges (by merge time) are kept; `develop/` is never
 * touched here.
 */

export type MergeListing = {
  objects: { key: string }[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
};

export interface MergeBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  list(options: { prefix: string; delimiter?: string; cursor?: string }): Promise<MergeListing>;
  delete(keys: string[]): Promise<void>;
}

/** What the gallery lists for one merge. */
export type MergeSummary = SnapshotInfo & { generatedAt: string; images: number };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function mergeSummaryBytes(summary: MergeSummary): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(summary)}\n`);
}

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 48) return null;
  return value.every((item) => typeof item === "string" && ID.test(item)) ? (value as string[]) : null;
}

/** A stored summary, re-checked on read; anything unexpected is treated as missing. */
export function parseMergeSummary(bytes: Uint8Array, id: string): MergeSummary | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pr = record.pr as Record<string, unknown> | undefined;
  if (
    record.id !== id ||
    record.kind !== "merge" ||
    !pr ||
    typeof pr !== "object" ||
    !Number.isInteger(pr.number) ||
    typeof pr.title !== "string" ||
    pr.title.length === 0 ||
    pr.title.length > 200 ||
    CONTROL.test(pr.title) ||
    typeof record.mergeCommit !== "string" ||
    !COMMIT.test(record.mergeCommit) ||
    typeof record.mergedAt !== "string" ||
    !TIMESTAMP.test(record.mergedAt) ||
    typeof record.generatedAt !== "string" ||
    !TIMESTAMP.test(record.generatedAt) ||
    !Number.isInteger(record.images)
  ) {
    return null;
  }
  const screens = ids(record.screens);
  const viewports = ids(record.viewports);
  if (!screens || !viewports) return null;
  return {
    id,
    kind: "merge",
    pr: { number: pr.number as number, title: pr.title },
    mergeCommit: record.mergeCommit,
    mergedAt: record.mergedAt,
    screens,
    viewports,
    generatedAt: record.generatedAt,
    images: record.images as number,
  };
}

/** Every folder name under `merges/`, valid id or not. */
async function mergeFolders(bucket: MergeBucket): Promise<string[]> {
  const folders: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const listing = await bucket.list({ prefix: MERGES_PREFIX, delimiter: "/", cursor });
    for (const prefix of listing.delimitedPrefixes) {
      if (prefix.startsWith(MERGES_PREFIX) && prefix.endsWith("/")) {
        folders.push(prefix.slice(MERGES_PREFIX.length, -1));
      }
    }
    if (!listing.truncated || !listing.cursor) return folders;
    cursor = listing.cursor;
  }
  throw new Error("merge listing did not finish");
}

function newestFirst(left: MergeSummary, right: MergeSummary): number {
  const byTime = Date.parse(right.mergedAt) - Date.parse(left.mergedAt);
  if (byTime !== 0) return byTime;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/** Every merge folder with a readable summary, newest merge first, and the folders without one. */
async function readHistory(bucket: MergeBucket): Promise<{ merges: MergeSummary[]; broken: string[] }> {
  const merges: MergeSummary[] = [];
  const broken: string[] = [];
  for (const folder of await mergeFolders(bucket)) {
    if (!SNAPSHOT_ID.test(folder)) {
      broken.push(folder);
      continue;
    }
    const object = await bucket.get(snapshotManifestKey(folder));
    const summary = object ? parseMergeSummary(new Uint8Array(await object.arrayBuffer()), folder) : null;
    if (summary) merges.push(summary);
    else broken.push(folder);
  }
  merges.sort(newestFirst);
  return { merges, broken };
}

/** The merges the gallery offers: the newest MERGE_HISTORY_LIMIT. */
export async function listMerges(bucket: MergeBucket): Promise<MergeSummary[]> {
  return (await readHistory(bucket)).merges.slice(0, MERGE_HISTORY_LIMIT);
}

/**
 * Remove every merge folder past the newest MERGE_HISTORY_LIMIT, and folders
 * without a readable summary (an interrupted publish), except `keep`, the
 * merge that was just stored. Runs only after that merge was stored.
 */
export async function pruneMerges(bucket: MergeBucket, keep: string): Promise<string[]> {
  const { merges, broken } = await readHistory(bucket);
  const removed = [...merges.slice(MERGE_HISTORY_LIMIT).map((merge) => merge.id), ...broken.filter((folder) => folder !== keep)];
  for (const folder of removed) {
    const keys = SNAPSHOT_ID.test(folder)
      ? [snapshotArchiveKey(folder), snapshotManifestKey(folder)]
      : (await bucket.list({ prefix: `${MERGES_PREFIX}${folder}/` })).objects.map((object) => object.key);
    if (keys.length > 0) await bucket.delete(keys);
  }
  return removed;
}
