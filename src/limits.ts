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

/** The full develop gallery. Only a `/publish` (develop) upload writes it; nothing prunes it. */
export const CURRENT_ARCHIVE_KEY = "develop/archive.zip";

/** Where the develop gallery lived before the `develop/` prefix; read only until the next develop publish. */
export const LEGACY_ARCHIVE_KEY = "current-screenshots.zip";

/** How many merge snapshots are kept, newest merge time first. */
export const MERGE_HISTORY_LIMIT = 10;

/**
 * A merge snapshot id: `pr-<number>-<first 12 hex of the merge commit>`. The
 * same merge always maps to the same id, so a retried publish replaces its own
 * snapshot instead of adding another one.
 */
export const SNAPSHOT_ID = /^pr-[1-9][0-9]{0,6}-[0-9a-f]{12}$/;

/** Each merge snapshot has its own `merges/<id>/` folder, beside, never in place of, the current archive. */
export const MERGES_PREFIX = "merges/";

export function snapshotArchiveKey(id: string): string {
  if (!SNAPSHOT_ID.test(id)) throw new Error("invalid snapshot id");
  return `${MERGES_PREFIX}${id}/archive.zip`;
}

/** The merge's metadata, written after its archive, which the merge list reads. */
export function snapshotManifestKey(id: string): string {
  if (!SNAPSHOT_ID.test(id)) throw new Error("invalid snapshot id");
  return `${MERGES_PREFIX}${id}/manifest.json`;
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
