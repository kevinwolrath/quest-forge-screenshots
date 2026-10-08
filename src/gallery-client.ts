import type { ArchiveLimits } from "./limits.ts";

export type GalleryEvent = {
  key?: string;
  preventDefault?: () => void;
};

export type GalleryNode = {
  textContent: string;
  hidden: boolean;
  src: string;
  alt: string;
  type: string;
  disabled: boolean;
  append(child: GalleryNode): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: (event?: GalleryEvent) => void): void;
  showModal(): void;
  close(): void;
  focus(options?: { preventScroll?: boolean }): void;
};

export type GalleryDom = {
  getElementById(id: string): GalleryNode | null;
  createElement(tag: string): GalleryNode;
  activeElement: GalleryNode | null;
};

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Browser gallery startup. Kept free of imports so the Worker can embed
 * function source in the page. Server-side validation lives in archive.ts.
 */
export async function startGallery(
  doc: GalleryDom,
  fetchArchive: FetchLike,
  limits: ArchiveLimits,
): Promise<void> {
  const when = doc.getElementById("when");
  const status = doc.getElementById("status");
  const grid = doc.getElementById("grid");
  const viewer = doc.getElementById("viewer");
  const full = doc.getElementById("full");
  const fullLabel = doc.getElementById("full-label");
  const close = doc.getElementById("close");
  const prev = doc.getElementById("prev");
  const next = doc.getElementById("next");
  if (!when || !status || !grid || !viewer || !full || !fullLabel || !close || !prev || !next) return;

  const showStatus = (message: string) => {
    status.hidden = false;
    status.textContent = message;
  };

  const imagePath = /^images\/[a-z0-9][a-z0-9-]{0,40}\.(png|jpg|jpeg|webp)$/;
  const label = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$/;
  const generatedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (data: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u16 = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
  const u32 = (bytes: Uint8Array, offset: number) =>
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0;

  function fail(code: string): never {
    throw new Error(code);
  }

  const inflateRaw = async (compressed: Uint8Array, maxOut: number) => {
    const Stream = globalThis.DecompressionStream;
    if (typeof Stream !== "function") fail("malformed");
    const compressedBytes = new ArrayBuffer(compressed.byteLength);
    new Uint8Array(compressedBytes).set(compressed);
    const stream = new Blob([compressedBytes]).stream().pipeThrough(new Stream("deflate-raw"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        if (!step.value) continue;
        total += step.value.byteLength;
        if (total > maxOut) {
          await reader.cancel();
          fail("expanded_too_large");
        }
        chunks.push(step.value);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "expanded_too_large") throw error;
      fail("malformed");
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  };

  const unpack = async (bytes: Uint8Array) => {
    if (bytes.byteLength > limits.maxZipBytes) fail("too_large");
    if (bytes.byteLength < 22) fail("malformed");
    let eocd = -1;
    const min = Math.max(0, bytes.length - (22 + 0xffff));
    for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
      if (u32(bytes, offset) !== 0x06054b50) continue;
      if (offset + 22 + u16(bytes, offset + 20) === bytes.length) {
        eocd = offset;
        break;
      }
    }
    if (eocd < 0) fail("malformed");
    if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) fail("malformed");
    const totalEntries = u16(bytes, eocd + 10);
    const centralSize = u32(bytes, eocd + 12);
    const centralOffset = u32(bytes, eocd + 16);
    if (u16(bytes, eocd + 8) !== totalEntries) fail("malformed");
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      fail("malformed");
    }
    if (totalEntries > limits.maxEntries) fail("too_many_entries");
    if (centralOffset + centralSize > bytes.length) fail("malformed");

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const entries: { name: string; bytes: Uint8Array }[] = [];
    const seen = new Set<string>();
    let expanded = 0;
    let cursor = centralOffset;
    const centralEnd = centralOffset + centralSize;
    for (let index = 0; index < totalEntries; index += 1) {
      if (cursor + 46 > centralEnd || u32(bytes, cursor) !== 0x02014b50) fail("malformed");
      const flags = u16(bytes, cursor + 8);
      const method = u16(bytes, cursor + 10);
      const crc = u32(bytes, cursor + 16);
      const compressedSize = u32(bytes, cursor + 20);
      const uncompressedSize = u32(bytes, cursor + 24);
      const nameLength = u16(bytes, cursor + 28);
      const extraLength = u16(bytes, cursor + 30);
      const commentLength = u16(bytes, cursor + 32);
      const localOffset = u32(bytes, cursor + 42);
      if (cursor + 46 + nameLength + extraLength + commentLength > centralEnd) fail("malformed");
      if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0 || (method !== 0 && method !== 8)) {
        fail("malformed");
      }
      if (uncompressedSize > limits.maxEntryBytes) fail("expanded_too_large");
      let name: string;
      try {
        name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      } catch {
        fail("bad_path");
      }
      const safe = name === "manifest.json" || imagePath.test(name);
      if (!safe || seen.has(name)) fail("bad_path");
      seen.add(name);
      if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== 0x04034b50) fail("malformed");
      const localNameLength = u16(bytes, localOffset + 26);
      const localExtraLength = u16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > bytes.length) fail("malformed");
      let localName: string;
      try {
        localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
      } catch {
        fail("bad_path");
      }
      if (localName !== name) fail("bad_path");
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? compressed.slice() : await inflateRaw(compressed, uncompressedSize);
      if (data.length !== uncompressedSize || crc32(data) !== crc) fail("malformed");
      expanded += data.length;
      if (expanded > limits.maxExpandedBytes) fail("expanded_too_large");
      entries.push({ name, bytes: data });
      cursor += 46 + nameLength + extraLength + commentLength;
    }

    const manifest = entries.find((entry) => entry.name === "manifest.json");
    if (!manifest) fail("bad_manifest");
    let parsed: { generatedAt?: unknown; images?: unknown };
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes)) as {
        generatedAt?: unknown;
        images?: unknown;
      };
    } catch {
      fail("bad_manifest");
    }
    if (!parsed || Array.isArray(parsed)) fail("bad_manifest");
    const keys = Object.keys(parsed).sort();
    if (keys.length !== 2 || keys[0] !== "generatedAt" || keys[1] !== "images") fail("bad_manifest");
    if (typeof parsed.generatedAt !== "string" || !generatedAtPattern.test(parsed.generatedAt)) {
      fail("bad_manifest");
    }
    if (!Array.isArray(parsed.images)) fail("bad_manifest");
    const images: { file: string; screen: string; viewport: string; bytes: Uint8Array; type: string }[] = [];
    for (const image of parsed.images) {
      if (!image || typeof image !== "object" || Array.isArray(image)) fail("bad_manifest");
      const item = image as { file?: unknown; screen?: unknown; viewport?: unknown };
      const itemKeys = Object.keys(item).sort();
      if (itemKeys.length !== 3 || itemKeys[0] !== "file" || itemKeys[1] !== "screen" || itemKeys[2] !== "viewport") {
        fail("bad_manifest");
      }
      if (typeof item.file !== "string" || !imagePath.test(item.file)) fail("bad_manifest");
      if (typeof item.screen !== "string" || !label.test(item.screen)) fail("bad_manifest");
      if (typeof item.viewport !== "string" || !label.test(item.viewport)) fail("bad_manifest");
      const entry = entries.find((candidate) => candidate.name === item.file);
      if (!entry) fail("bad_manifest");
      const png =
        item.file.endsWith(".png") &&
        entry.bytes.length >= 8 &&
        entry.bytes[0] === 0x89 &&
        entry.bytes[1] === 0x50 &&
        entry.bytes[2] === 0x4e &&
        entry.bytes[3] === 0x47;
      const jpeg =
        (item.file.endsWith(".jpg") || item.file.endsWith(".jpeg")) &&
        entry.bytes.length >= 3 &&
        entry.bytes[0] === 0xff &&
        entry.bytes[1] === 0xd8 &&
        entry.bytes[2] === 0xff;
      const webp =
        item.file.endsWith(".webp") &&
        entry.bytes.length >= 12 &&
        entry.bytes[8] === 0x57 &&
        entry.bytes[9] === 0x45 &&
        entry.bytes[10] === 0x42 &&
        entry.bytes[11] === 0x50;
      if (!png && !jpeg && !webp) fail("bad_type");
      const type = png ? "image/png" : webp ? "image/webp" : "image/jpeg";
      images.push({
        file: item.file,
        screen: item.screen,
        viewport: item.viewport,
        bytes: entry.bytes,
        type,
      });
    }
    for (const entry of entries) {
      if (entry.name === "manifest.json") continue;
      if (!images.some((image) => image.file === entry.name)) fail("unexpected_entry");
    }
    return { generatedAt: parsed.generatedAt, images };
  };

  let response: { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> };
  try {
    response = await fetchArchive("/archive");
  } catch {
    showStatus("The current archive could not be shown.");
    return;
  }
  if (response.status === 404) {
    showStatus("No screenshots have been published yet.");
    return;
  }
  if (!response.ok) {
    showStatus("The current archive could not be shown.");
    return;
  }

  let unpacked;
  try {
    const buffer = new Uint8Array(await response.arrayBuffer());
    unpacked = await unpack(buffer);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    showStatus(
      code === "too_large" || code === "expanded_too_large"
        ? "The archive is too large to open in the browser."
        : "The current archive could not be shown.",
    );
    return;
  }

  when.textContent = unpacked.generatedAt;
  if (unpacked.images.length === 0) {
    showStatus("This capture has no screenshots.");
    return;
  }
  status.hidden = true;
  status.textContent = "";

  const slides: { src: string; caption: string }[] = [];
  let index = 0;
  let opener: GalleryNode | null = null;
  let savedScroll = 0;

  const readScroll = () => (typeof globalThis.scrollY === "number" ? globalThis.scrollY : 0);
  const restoreScroll = (y: number) => {
    const scrollTo = globalThis.scrollTo;
    if (typeof scrollTo === "function") scrollTo(0, y);
  };

  const showAt = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= slides.length) return;
    const slide = slides[nextIndex];
    if (!slide) return;
    index = nextIndex;
    full.src = slide.src;
    full.alt = slide.caption;
    fullLabel.textContent = slide.caption;
    const atStart = index === 0;
    const atEnd = index === slides.length - 1;
    const active = doc.activeElement;
    if ((atStart && active === prev) || (atEnd && active === next)) close.focus({ preventScroll: true });
    prev.disabled = atStart;
    next.disabled = atEnd;
  };

  const move = (delta: number) => {
    showAt(index + delta);
  };

  for (const image of unpacked.images) {
    const figure = doc.createElement("figure");
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("type", "button");
    const img = doc.createElement("img");
    const caption = image.screen + " · " + image.viewport;
    img.alt = caption;
    const imageBytes = new ArrayBuffer(image.bytes.byteLength);
    new Uint8Array(imageBytes).set(image.bytes);
    img.src = URL.createObjectURL(new Blob([imageBytes], { type: image.type }));
    const figcaption = doc.createElement("figcaption");
    figcaption.textContent = caption;
    button.append(img);
    button.append(figcaption);
    const slideIndex = slides.length;
    slides.push({ src: img.src, caption });
    button.addEventListener("click", () => {
      opener = button;
      savedScroll = readScroll();
      showAt(slideIndex);
      viewer.showModal();
      close.focus({ preventScroll: true });
    });
    figure.append(button);
    grid.append(figure);
  }

  prev.addEventListener("click", () => {
    if (prev.disabled) return;
    move(-1);
  });
  next.addEventListener("click", () => {
    if (next.disabled) return;
    move(1);
  });
  close.addEventListener("click", () => {
    viewer.close();
  });
  viewer.addEventListener("keydown", (event) => {
    const key = event?.key;
    if (key === "ArrowLeft") {
      event?.preventDefault?.();
      if (!prev.disabled) move(-1);
    } else if (key === "ArrowRight") {
      event?.preventDefault?.();
      if (!next.disabled) move(1);
    }
  });
  viewer.addEventListener("close", () => {
    const target = opener;
    opener = null;
    target?.focus({ preventScroll: true });
    restoreScroll(savedScroll);
  });
}
