import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ArchiveRejection, buildStoredZip, crc32, validateGalleryZip } from "../src/archive.ts";
import { LIMITS } from "../src/limits.ts";
import { deflatedGalleryZip, galleryZip, JPEG, PNG } from "./gallery-fixtures.ts";

describe("gallery zip validation", () => {
  it("accepts a stored synthetic archive and a deflated image", async () => {
    const stored = await validateGalleryZip(galleryZip());
    assert.equal(stored.generatedAt, "2026-10-04T12:00:00.000Z");
    assert.equal(stored.images.length, 1);
    assert.equal(stored.images[0]?.screen, "home");
    assert.equal(stored.images[0]?.viewport, "desktop");
    assert.deepEqual(stored.images[0]?.bytes, PNG);

    const deflated = await validateGalleryZip(deflatedGalleryZip());
    assert.deepEqual(deflated.images[0]?.bytes, PNG);
  });

  it("rejects capture metadata, traversal, types, and oversized archives", async () => {
    const withPath = galleryZip(undefined, { baseUrl: "http://localhost", outputDir: "/Users/example/shots" });
    await assert.rejects(() => validateGalleryZip(withPath), (error: unknown) => {
      assert.ok(error instanceof ArchiveRejection);
      assert.equal(error.code, "bad_manifest");
      return true;
    });

    const traversal = buildStoredZip([
      {
        name: "manifest.json",
        data: new TextEncoder().encode(
          JSON.stringify({
            generatedAt: "2026-10-04T12:00:00.000Z",
            images: [],
          }),
        ),
      },
      { name: "../secret.png", data: PNG },
    ]);
    await assert.rejects(() => validateGalleryZip(traversal), /bad_path/);

    const wrongType = galleryZip([
      { file: "images/home-desktop.png", screen: "home", viewport: "desktop", bytes: JPEG },
    ]);
    await assert.rejects(() => validateGalleryZip(wrongType), /bad_type/);

    await assert.rejects(
      () => validateGalleryZip(galleryZip(), { ...LIMITS, maxZipBytes: 32 }),
      /too_large/,
    );
    assert.ok(LIMITS.maxZipBytes < 100 * 1024 * 1024);
  });

  it("uses the standard CRC-32 check value", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });
});
