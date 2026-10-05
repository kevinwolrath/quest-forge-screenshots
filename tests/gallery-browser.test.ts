import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { chromium, type Browser } from "playwright";

import { handleRequest } from "../src/gallery.ts";
import { PNG, galleryZip } from "./gallery-fixtures.ts";
import { MemoryBucket } from "./memory-bucket.ts";

const TOKEN = "browser-access-token";

async function listen(bucket: MemoryBucket): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await handleRequest(
      request,
      { SCREENSHOTS: bucket, PUBLISH_SECRET: "unused-publish-secret-value" },
      { verifyAccess: async (jwt) => jwt === TOKEN },
    );
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("gallery browser", () => {
  it("shows a flat grid and opens an image on desktop and mobile", async () => {
    const bucket = new MemoryBucket();
    const zip = galleryZip([
      { file: "images/home-desktop.png", screen: "home", viewport: "desktop", bytes: PNG },
      { file: "images/home-mobile.png", screen: "home", viewport: "mobile", bytes: PNG },
    ]);
    bucket.objects.set("current-screenshots.zip", zip);
    const server = await listen(bucket);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage({
        extraHTTPHeaders: { "cf-access-jwt-assertion": TOKEN },
      });
      const archiveCalls: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/archive")) archiveCalls.push(request.url());
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      const response = await page.goto(server.baseUrl + "/", { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200);
      await page.waitForSelector("figcaption");
      const captions = await page.locator("figcaption").allTextContents();
      assert.deepEqual(captions, ["home · desktop", "home · mobile"]);
      assert.match(await page.locator("#when").innerText(), /2026-10-04T12:00:00.000Z/);
      assert.equal(archiveCalls.length, 1);
      await page.locator("button", { hasText: "home · mobile" }).click();
      await page.waitForSelector("dialog[open]");
      assert.equal(await page.locator("#full-label").innerText(), "home · mobile");
      const fullBox = await page.locator("#full").boundingBox();
      assert.ok(fullBox && fullBox.width > 200);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("figcaption");
      const mobileCaptions = await page.locator("figcaption").allTextContents();
      assert.deepEqual(mobileCaptions, ["home · desktop", "home · mobile"]);
      const card = await page.locator("figure img").first().boundingBox();
      assert.ok(card && card.width > 100 && card.width < 390);
    } finally {
      await browser?.close();
      await server.close();
    }
  });
});
