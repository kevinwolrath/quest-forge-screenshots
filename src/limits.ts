/** Below the Cloudflare Workers Free plan request-body limit (100 MiB). */
export const LIMITS = {
  maxZipBytes: 20 * 1024 * 1024,
  maxEntries: 49,
  maxExpandedBytes: 40 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
} as const;

export type ArchiveLimits = {
  maxZipBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
};

export const CURRENT_ARCHIVE_KEY = "current-screenshots.zip";

/**
 * A merge snapshot id: `pr-<number>-<first 12 hex of the merge commit>`. The
 * same merge always maps to the same id, so a retried publish replaces its own
 * snapshot instead of adding another one.
 */
export const SNAPSHOT_ID = /^pr-[1-9][0-9]{0,6}-[0-9a-f]{12}$/;

/** Merge snapshots are stored beside, never in place of, the current archive. */
export function snapshotArchiveKey(id: string): string {
  if (!SNAPSHOT_ID.test(id)) throw new Error("invalid snapshot id");
  return `snapshots/${id}.zip`;
}

export const REJECTION_CODES = [
  "malformed",
  "too_large",
  "too_many_entries",
  "expanded_too_large",
  "bad_path",
  "bad_type",
  "bad_manifest",
  "unexpected_entry",
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];
