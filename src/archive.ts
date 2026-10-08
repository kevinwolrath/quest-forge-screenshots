import {
  LIMITS,
  SNAPSHOT_ID,
  type ArchiveLimits,
  type RejectionCode,
} from "./limits.ts";

export class ArchiveRejection extends Error {
  readonly code: RejectionCode;

  constructor(code: RejectionCode) {
    super(code);
    this.name = "ArchiveRejection";
    this.code = code;
  }
}

export type GalleryImage = {
  file: string;
  screen: string;
  viewport: string;
  bytes: Uint8Array;
};

export type ValidatedArchive = {
  generatedAt: string;
  images: GalleryImage[];
};

/** What a merge snapshot says about the merge it shows. */
export type SnapshotInfo = {
  id: string;
  kind: "merge";
  pr: { number: number; title: string };
  mergeCommit: string;
  mergedAt: string;
  screens: string[];
  viewports: string[];
};

export type ValidatedSnapshot = ValidatedArchive & { snapshot: SnapshotInfo };

const IMAGE_PATH = /^images\/[a-z0-9][a-z0-9-]{0,40}\.(png|jpg|jpeg|webp)$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$/;
const GENERATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const MAX_TITLE = 200;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

type ZipEntryInput = {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  compressed?: Uint8Array;
};

export function buildZip(files: ZipEntryInput[]): Uint8Array {
  const encoded = files.map((file) => {
    const name = new TextEncoder().encode(file.name);
    const method = file.method ?? 0;
    const compressed = method === 0 ? file.data : file.compressed;
    if (!compressed) {
      throw new Error("compressed bytes are required for method 8");
    }
    return { name, data: file.data, compressed, method };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const file of encoded) {
    localSize += 30 + file.name.length + file.compressed.length;
    centralSize += 46 + file.name.length;
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const locals: number[] = [];

  for (const file of encoded) {
    locals.push(offset);
    writeU32(view, offset, 0x04034b50);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 0x0800);
    writeU16(view, offset + 8, file.method);
    writeU16(view, offset + 10, 0);
    writeU16(view, offset + 12, 33);
    writeU32(view, offset + 14, crc32(file.data));
    writeU32(view, offset + 18, file.compressed.length);
    writeU32(view, offset + 22, file.data.length);
    writeU16(view, offset + 26, file.name.length);
    writeU16(view, offset + 28, 0);
    out.set(file.name, offset + 30);
    out.set(file.compressed, offset + 30 + file.name.length);
    offset += 30 + file.name.length + file.compressed.length;
  }

  const centralOffset = offset;
  for (let index = 0; index < encoded.length; index += 1) {
    const file = encoded[index]!;
    writeU32(view, offset, 0x02014b50);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 20);
    writeU16(view, offset + 8, 0x0800);
    writeU16(view, offset + 10, file.method);
    writeU16(view, offset + 12, 0);
    writeU16(view, offset + 14, 33);
    writeU32(view, offset + 16, crc32(file.data));
    writeU32(view, offset + 20, file.compressed.length);
    writeU32(view, offset + 24, file.data.length);
    writeU16(view, offset + 28, file.name.length);
    writeU16(view, offset + 30, 0);
    writeU16(view, offset + 32, 0);
    writeU16(view, offset + 34, 0);
    writeU16(view, offset + 36, 0);
    writeU32(view, offset + 38, 0);
    writeU32(view, offset + 42, locals[index]!);
    out.set(file.name, offset + 46);
    offset += 46 + file.name.length;
  }

  writeU32(view, offset, 0x06054b50);
  writeU16(view, offset + 4, 0);
  writeU16(view, offset + 6, 0);
  writeU16(view, offset + 8, encoded.length);
  writeU16(view, offset + 10, encoded.length);
  writeU32(view, offset + 12, offset - centralOffset);
  writeU32(view, offset + 16, centralOffset);
  writeU16(view, offset + 20, 0);
  return out;
}

export function buildStoredZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  return buildZip(files.map((file) => ({ ...file, method: 0 as const })));
}

type RawEntry = {
  name: string;
  bytes: Uint8Array;
};

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - (22 + 0xffff));
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (u32(bytes, offset) !== 0x06054b50) continue;
    const commentLength = u16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new ArchiveRejection("malformed");
}

async function inflateRaw(compressed: Uint8Array, maxOut: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new ArchiveRejection("malformed");
  }
  const compressedBytes = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(compressedBytes).set(compressed);
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxOut) {
        await reader.cancel();
        throw new ArchiveRejection("expanded_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ArchiveRejection) throw error;
    throw new ArchiveRejection("malformed");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isSafeEntryName(name: string): boolean {
  if (name === "manifest.json") return true;
  return IMAGE_PATH.test(name);
}

function matchesMagic(name: string, data: Uint8Array): boolean {
  if (name.endsWith(".png")) {
    return (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    );
  }
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (name.endsWith(".webp")) {
    return (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    );
  }
  return false;
}

async function readEntries(bytes: Uint8Array, limits: ArchiveLimits): Promise<RawEntry[]> {
  const eocd = findEocd(bytes);
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new ArchiveRejection("malformed");
  }
  const entriesOnDisk = u16(bytes, eocd + 8);
  const totalEntries = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ArchiveRejection("malformed");
  }
  if (entriesOnDisk !== totalEntries) throw new ArchiveRejection("malformed");
  if (totalEntries > limits.maxEntries) throw new ArchiveRejection("too_many_entries");
  if (centralOffset + centralSize > bytes.length) throw new ArchiveRejection("malformed");

  const entries: RawEntry[] = [];
  const seen = new Set<string>();
  let expanded = 0;
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralEnd) throw new ArchiveRejection("malformed");
    if (u32(bytes, cursor) !== 0x02014b50) throw new ArchiveRejection("malformed");
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const crc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > centralEnd) {
      throw new ArchiveRejection("malformed");
    }
    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) throw new ArchiveRejection("malformed");
    if (method !== 0 && method !== 8) throw new ArchiveRejection("malformed");
    if (uncompressedSize > limits.maxEntryBytes || compressedSize > limits.maxZipBytes) {
      throw new ArchiveRejection("expanded_too_large");
    }

    let name: string;
    try {
      name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    } catch {
      throw new ArchiveRejection("bad_path");
    }
    if (!isSafeEntryName(name) || seen.has(name)) throw new ArchiveRejection("bad_path");
    seen.add(name);

    if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== 0x04034b50) {
      throw new ArchiveRejection("malformed");
    }
    const localFlags = u16(bytes, localOffset + 6);
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if ((localFlags & 0x1) !== 0) throw new ArchiveRejection("malformed");
    if (dataStart + compressedSize > bytes.length) throw new ArchiveRejection("malformed");
    let localName: string;
    try {
      localName = decoder.decode(
        bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      );
    } catch {
      throw new ArchiveRejection("bad_path");
    }
    if (localName !== name) throw new ArchiveRejection("bad_path");

    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const data =
      method === 0 ? compressed.slice() : await inflateRaw(compressed, uncompressedSize);
    if (data.length !== uncompressedSize) throw new ArchiveRejection("malformed");
    if (crc32(data) !== crc) throw new ArchiveRejection("malformed");
    expanded += data.length;
    if (expanded > limits.maxExpandedBytes) throw new ArchiveRejection("expanded_too_large");
    entries.push({ name, bytes: data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralEnd) throw new ArchiveRejection("malformed");
  return entries;
}

type ParsedManifest = {
  generatedAt: string;
  images: Array<{ file: string; screen: string; viewport: string }>;
  snapshot?: SnapshotInfo;
};

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && GENERATED_AT.test(value) && Number.isFinite(Date.parse(value));
}

function idList(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new ArchiveRejection("bad_manifest");
  }
  for (const item of value) {
    if (typeof item !== "string" || !ID.test(item)) throw new ArchiveRejection("bad_manifest");
  }
  if (new Set(value).size !== value.length) throw new ArchiveRejection("bad_manifest");
  return value as string[];
}

function exactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * A merge snapshot's `snapshot` block. The id is derived from the PR number
 * and merge commit, so the stored key cannot drift from the merge it labels.
 */
function parseSnapshot(
  value: unknown,
  images: Array<{ screen: string; viewport: string }>,
  limits: ArchiveLimits,
): SnapshotInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ArchiveRejection("bad_manifest");
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["id", "kind", "pr", "mergeCommit", "mergedAt", "screens", "viewports"])) {
    throw new ArchiveRejection("bad_manifest");
  }
  if (record.kind !== "merge") throw new ArchiveRejection("bad_manifest");
  const pr = record.pr;
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) throw new ArchiveRejection("bad_manifest");
  const prRecord = pr as Record<string, unknown>;
  if (!exactKeys(prRecord, ["number", "title"])) throw new ArchiveRejection("bad_manifest");
  const number = prRecord.number;
  const title = prRecord.title;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 9_999_999) {
    throw new ArchiveRejection("bad_manifest");
  }
  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title !== title.trim() ||
    title.length > MAX_TITLE ||
    CONTROL.test(title)
  ) {
    throw new ArchiveRejection("bad_manifest");
  }
  if (typeof record.mergeCommit !== "string" || !COMMIT.test(record.mergeCommit)) {
    throw new ArchiveRejection("bad_manifest");
  }
  if (!isTimestamp(record.mergedAt)) throw new ArchiveRejection("bad_manifest");
  const id = record.id;
  if (typeof id !== "string" || !SNAPSHOT_ID.test(id) || id !== `pr-${number}-${record.mergeCommit.slice(0, 12)}`) {
    throw new ArchiveRejection("bad_manifest");
  }
  const screens = idList(record.screens, limits.maxEntries - 1);
  const viewports = idList(record.viewports, limits.maxEntries - 1);
  // Every image belongs to a declared screen and viewport, and every declared one has an image.
  const usedScreens = new Set<string>();
  const usedViewports = new Set<string>();
  for (const image of images) {
    const viewportId = image.viewport.split(" ")[0]!;
    if (!screens.includes(image.screen) || !viewports.includes(viewportId)) {
      throw new ArchiveRejection("bad_manifest");
    }
    usedScreens.add(image.screen);
    usedViewports.add(viewportId);
  }
  if (usedScreens.size !== screens.length || usedViewports.size !== viewports.length) {
    throw new ArchiveRejection("bad_manifest");
  }
  return {
    id,
    kind: "merge",
    pr: { number, title },
    mergeCommit: record.mergeCommit,
    mergedAt: record.mergedAt,
    screens: [...screens],
    viewports: [...viewports],
  };
}

function parseManifest(bytes: Uint8Array, limits: ArchiveLimits, snapshot = false): ParsedManifest {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArchiveRejection("bad_manifest");
  }
  if (text.length > 100_000) throw new ArchiveRejection("bad_manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ArchiveRejection("bad_manifest");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ArchiveRejection("bad_manifest");
  }
  const record = parsed as Record<string, unknown>;
  if (!exactKeys(record, snapshot ? ["generatedAt", "images", "snapshot"] : ["generatedAt", "images"])) {
    throw new ArchiveRejection("bad_manifest");
  }
  if (!isTimestamp(record.generatedAt)) throw new ArchiveRejection("bad_manifest");
  if (!Array.isArray(record.images) || record.images.length > limits.maxEntries - 1) {
    throw new ArchiveRejection("bad_manifest");
  }
  const images = record.images.map((image) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new ArchiveRejection("bad_manifest");
    }
    const item = image as Record<string, unknown>;
    const itemKeys = Object.keys(item).sort();
    if (
      itemKeys.length !== 3 ||
      itemKeys[0] !== "file" ||
      itemKeys[1] !== "screen" ||
      itemKeys[2] !== "viewport"
    ) {
      throw new ArchiveRejection("bad_manifest");
    }
    if (typeof item.file !== "string" || !IMAGE_PATH.test(item.file)) {
      throw new ArchiveRejection("bad_manifest");
    }
    if (typeof item.screen !== "string" || !LABEL.test(item.screen)) {
      throw new ArchiveRejection("bad_manifest");
    }
    if (typeof item.viewport !== "string" || !LABEL.test(item.viewport)) {
      throw new ArchiveRejection("bad_manifest");
    }
    return { file: item.file, screen: item.screen, viewport: item.viewport };
  });
  const files = new Set(images.map((image) => image.file));
  if (files.size !== images.length) throw new ArchiveRejection("bad_manifest");
  if (!snapshot) return { generatedAt: record.generatedAt, images };
  if (images.length === 0) throw new ArchiveRejection("bad_manifest");
  return { generatedAt: record.generatedAt, images, snapshot: parseSnapshot(record.snapshot, images, limits) };
}

async function validateZip(bytes: Uint8Array, limits: ArchiveLimits, snapshot: boolean) {
  if (bytes.byteLength > limits.maxZipBytes) throw new ArchiveRejection("too_large");
  if (bytes.byteLength < 22) throw new ArchiveRejection("malformed");
  const entries = await readEntries(bytes, limits);
  const manifest = entries.find((entry) => entry.name === "manifest.json");
  if (!manifest) throw new ArchiveRejection("bad_manifest");
  const parsed = parseManifest(manifest.bytes, limits, snapshot);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (byName.size !== entries.length) throw new ArchiveRejection("bad_path");
  const images: GalleryImage[] = [];
  for (const image of parsed.images) {
    const entry = byName.get(image.file);
    if (!entry) throw new ArchiveRejection("bad_manifest");
    if (!matchesMagic(image.file, entry.bytes)) throw new ArchiveRejection("bad_type");
    images.push({ ...image, bytes: entry.bytes });
  }
  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    if (!parsed.images.some((image) => image.file === entry.name)) {
      throw new ArchiveRejection("unexpected_entry");
    }
  }
  return { generatedAt: parsed.generatedAt, images, snapshot: parsed.snapshot };
}

/** The current archive: a manifest of only `generatedAt` and `images`. */
export async function validateGalleryZip(
  bytes: Uint8Array,
  limits: ArchiveLimits = LIMITS,
): Promise<ValidatedArchive> {
  const { generatedAt, images } = await validateZip(bytes, limits, false);
  return { generatedAt, images };
}

/**
 * A merge snapshot: the same archive rules, plus a required `snapshot` block
 * naming the PR, merge commit, merge time, screens and viewports.
 */
export async function validateSnapshotZip(
  bytes: Uint8Array,
  limits: ArchiveLimits = LIMITS,
): Promise<ValidatedSnapshot> {
  const { generatedAt, images, snapshot } = await validateZip(bytes, limits, true);
  if (!snapshot) throw new ArchiveRejection("bad_manifest");
  return { generatedAt, images, snapshot };
}
