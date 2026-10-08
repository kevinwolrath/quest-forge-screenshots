import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { galleryDocumentHtml } from "../src/gallery-page.ts";
import { handleRequest, type GalleryBindings } from "../src/gallery.ts";
import { CURRENT_ARCHIVE_KEY } from "../src/limits.ts";
import { galleryZip, PNG } from "./gallery-fixtures.ts";
import { MemoryBucket } from "./memory-bucket.ts";

const SECRET = "test-publish-secret-value";
const TOKEN = "test-access-token";

function bindings(bucket: MemoryBucket, secret = SECRET): GalleryBindings {
  return { SCREENSHOTS: bucket, PUBLISH_SECRET: secret };
}

function viewer(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-jwt-assertion", TOKEN);
  return new Request(`https://gallery.test${pathname}`, { ...init, headers });
}

const allowTestToken = {
  verifyAccess: async (jwt: string) => jwt === TOKEN,
};

describe("fail-closed gallery routes", () => {
  it("blocks viewer routes before reading storage", async () => {
    const bucket = new MemoryBucket();
    bucket.objects.set(CURRENT_ARCHIVE_KEY, galleryZip());
    for (const pathname of ["/", "/archive", "/images/home-desktop.png"]) {
      const response = await handleRequest(new Request(`https://gallery.test${pathname}`), bindings(bucket));
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Forbidden\n");
      assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    }
    assert.deepEqual(bucket.gets, []);
    assert.equal(bucket.puts.length, 0);

    const withHeader = await handleRequest(viewer("/"), bindings(bucket));
    assert.equal(withHeader.status, 403);
    assert.deepEqual(bucket.gets, []);
  });

  it("serves one flat page and one zip to an allowed viewer", async () => {
    const bucket = new MemoryBucket();
    const zip = galleryZip([
      { file: "images/home-desktop.png", screen: "home", viewport: "desktop", bytes: PNG },
      { file: "images/home-mobile.png", screen: "home", viewport: "mobile", bytes: PNG },
    ]);
    const published = await handleRequest(
      new Request("https://gallery.test/publish", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/zip" },
        body: Buffer.from(zip),
      }),
      bindings(bucket),
    );
    assert.equal(published.status, 200);
    const publishedBody = (await published.json()) as { archive: string; images: string[] };
    assert.equal(publishedBody.archive, CURRENT_ARCHIVE_KEY);
    assert.deepEqual(publishedBody.images, ["images/home-desktop.png", "images/home-mobile.png"]);
    assert.equal(JSON.stringify(publishedBody).includes(SECRET), false);
    assert.deepEqual(bucket.puts, [CURRENT_ARCHIVE_KEY]);

    const page = await handleRequest(viewer("/"), bindings(bucket), allowTestToken);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /QuestForge Screenshot Gallery/);
    assert.match(html, /Latest previews across themes and screen sizes/);
    assert.match(html, /grid-template-columns/);
    assert.match(html, /@media \(max-width: 640px\)/);
    assert.match(html, /--gold:/);
    assert.match(html, /aria-label="Close image"/);
    assert.match(html, /aria-label="Previous image"/);
    assert.match(html, /aria-label="Next image"/);
    assert.match(html, /id="prev"/);
    assert.match(html, /id="next"/);
    assert.match(html, /title="Full size"/);
    assert.equal(html.includes("innerHTML"), false);
    assert.equal(html.includes(Buffer.from(PNG).toString("base64")), false);

    const archive = await handleRequest(viewer("/archive"), bindings(bucket), allowTestToken);
    assert.equal(archive.status, 200);
    assert.equal(archive.headers.get("content-type"), "application/zip");
    assert.deepEqual(new Uint8Array(await archive.arrayBuffer()), zip);
    assert.deepEqual(bucket.gets, [CURRENT_ARCHIVE_KEY]);

    const bearerPage = await handleRequest(
      new Request("https://gallery.test/", { headers: { authorization: `Bearer ${SECRET}` } }),
      bindings(bucket),
      allowTestToken,
    );
    assert.equal(bearerPage.status, 403);
  });

  it("replaces the current zip only after validation", async () => {
    const bucket = new MemoryBucket();
    const first = galleryZip();
    const second = galleryZip([
      { file: "images/home-mobile.png", screen: "home", viewport: "mobile", bytes: PNG },
    ]);
    const publish = (body: Uint8Array, secret = SECRET) =>
      handleRequest(
        new Request("https://gallery.test/publish", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/zip" },
          body: Buffer.from(body),
        }),
        bindings(bucket),
      );

    assert.equal((await publish(first)).status, 200);
    const bad = await publish(
      galleryZip(undefined, { outputDir: "C:/captures" }),
    );
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: string }).error, "bad_manifest");
    assert.deepEqual(bucket.objects.get(CURRENT_ARCHIVE_KEY), first);

    bucket.failPut = true;
    const failed = await publish(second);
    assert.equal(failed.status, 503);
    assert.deepEqual(bucket.objects.get(CURRENT_ARCHIVE_KEY), first);
    bucket.failPut = false;

    assert.equal((await publish(second)).status, 200);
    assert.deepEqual(bucket.objects.get(CURRENT_ARCHIVE_KEY), second);
    assert.equal(bucket.objects.size, 1);

    const missing = await publish(second, "");
    assert.equal(missing.status, 401);
    const wrong = await publish(first, "wrong-publish-secret-value");
    assert.equal(wrong.status, 401);
    assert.equal(await wrong.text(), "Unauthorized\n");
    assert.deepEqual(bucket.objects.get(CURRENT_ARCHIVE_KEY), second);

    const empty = await handleRequest(
      viewer("/archive"),
      { SCREENSHOTS: new MemoryBucket(), PUBLISH_SECRET: SECRET },
      allowTestToken,
    );
    assert.equal(empty.status, 404);
    assert.match(await empty.text(), /No screenshots have been published/);
  });

  it("keeps the page script free of markup injection", () => {
    const html = galleryDocumentHtml();
    assert.equal(html.includes("innerHTML"), false);
    assert.match(html, /fetch\(url, \{ cache: "no-store" \}\)/);
  });
});
