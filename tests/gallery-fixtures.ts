import { crc32, deflateRawSync, deflateSync } from "node:zlib";

import { buildStoredZip, buildZip } from "../src/archive.ts";

export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

/** Solid RGB PNG large enough to overflow a phone or desktop viewport. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(
    Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]),
  );
}

export const GENERATED_AT = "2026-10-04T12:00:00.000Z";

export function galleryZip(
  images: { file: string; screen: string; viewport: string; bytes: Uint8Array }[] = [
    { file: "images/home-desktop.png", screen: "home", viewport: "desktop", bytes: PNG },
  ],
  manifestExtras?: Record<string, unknown>,
): Uint8Array {
  const manifest = {
    generatedAt: GENERATED_AT,
    images: images.map(({ file, screen, viewport }) => ({ file, screen, viewport })),
    ...manifestExtras,
  };
  return buildStoredZip([
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...images.map((image) => ({ name: image.file, data: image.bytes })),
  ]);
}

export function deflatedGalleryZip(): Uint8Array {
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      generatedAt: GENERATED_AT,
      images: [{ file: "images/home-desktop.png", screen: "home", viewport: "desktop" }],
    }),
  );
  return buildZip([
    { name: "manifest.json", data: manifest },
    {
      name: "images/home-desktop.png",
      data: PNG,
      method: 8,
      compressed: new Uint8Array(deflateRawSync(PNG)),
    },
  ]);
}
