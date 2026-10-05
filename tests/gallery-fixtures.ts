import { deflateRawSync } from "node:zlib";

import { buildStoredZip, buildZip } from "../src/archive.ts";

export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

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
