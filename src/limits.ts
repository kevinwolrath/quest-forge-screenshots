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
