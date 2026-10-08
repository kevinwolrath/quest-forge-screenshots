import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { chromium, type Browser } from "playwright";

import { handleRequest } from "../src/gallery.ts";
import { PNG, galleryZip, solidPng } from "./gallery-fixtures.ts";
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
      assert.equal(await page.locator("h1").innerText(), "QuestForge Screenshot Gallery");
      assert.equal(
        await page.locator(".tagline").innerText(),
        "Latest previews across themes and screen sizes.",
      );
      const headerBox = await page.locator(".site-header").boundingBox();
      assert.ok(headerBox && headerBox.width > 1000);
      await page.waitForSelector("figcaption");
      const captions = await page.locator("figcaption").allTextContents();
      assert.deepEqual(captions, ["home · desktop", "home · mobile"]);
      assert.match(await page.locator("#when").innerText(), /2026-10-04T12:00:00.000Z/);
      assert.equal(archiveCalls.length, 1);
      await page.locator("button", { hasText: "home · mobile" }).click();
      await page.waitForSelector("dialog[open]");
      assert.equal(await page.locator("#full-label").innerText(), "home · mobile");
      assert.equal(await page.locator("#close").getAttribute("aria-label"), "Close image");
      const fullBox = await page.locator("#full").boundingBox();
      const viewport = page.viewportSize();
      assert.ok(fullBox && viewport);
      assert.ok(fullBox.x >= 0 && fullBox.y >= 0);
      assert.ok(fullBox.x + fullBox.width <= viewport.width + 1);
      assert.ok(fullBox.y + fullBox.height <= viewport.height + 1);
      const closeBox = await page.locator("#close").boundingBox();
      assert.ok(closeBox && closeBox.width >= 44 && closeBox.height >= 44);
      await page.locator("#close").click();
      assert.equal(await page.locator("dialog[open]").count(), 0);

      await page.setViewportSize({ width: 768, height: 1024 });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("figcaption");
      const tabletHeader = await page.locator(".site-header").boundingBox();
      assert.ok(tabletHeader && tabletHeader.width <= 768 && tabletHeader.width > 700);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("figcaption");
      const mobileCaptions = await page.locator("figcaption").allTextContents();
      assert.deepEqual(mobileCaptions, ["home · desktop", "home · mobile"]);
      const card = await page.locator("figure img").first().boundingBox();
      assert.ok(card && card.width > 100 && card.width < 390);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      const mobileTitle = await page.locator("h1").boundingBox();
      assert.ok(mobileTitle && mobileTitle.width < 390);
    } finally {
      await browser?.close();
      await server.close();
    }
  });

  it("fits portrait and landscape screenshots and keeps popup controls reachable", async () => {
    const landscape = { width: 1800, height: 1000 };
    const portrait = { width: 900, height: 1600 };
    const bucket = new MemoryBucket();
    const zip = galleryZip([
      { file: "images/wide-desktop.png", screen: "wide", viewport: "desktop", bytes: solidPng(landscape.width, landscape.height, [40, 90, 160]) },
      { file: "images/tall-mobile.png", screen: "tall", viewport: "mobile", bytes: solidPng(portrait.width, portrait.height, [160, 90, 40]) },
      { file: "images/square-tablet.png", screen: "square", viewport: "tablet", bytes: solidPng(1400, 1400, [40, 140, 90]) },
    ]);
    bucket.objects.set("current-screenshots.zip", zip);
    const server = await listen(bucket);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage({
        extraHTTPHeaders: { "cf-access-jwt-assertion": TOKEN },
      });

      const assertFitted = async (intrinsicWidth: number, intrinsicHeight: number) => {
        const viewport = page.viewportSize();
        const box = await page.locator("#full").boundingBox();
        assert.ok(viewport && box, "image and viewport are measurable");
        assert.ok(box.width > 20 && box.height > 20);
        assert.ok(box.x >= -1 && box.y >= -1);
        assert.ok(box.x + box.width <= viewport.width + 1);
        assert.ok(box.y + box.height <= viewport.height + 1);
        assert.ok(box.width < intrinsicWidth || box.height < intrinsicHeight);
        const ratio = box.width / box.height;
        const expected = intrinsicWidth / intrinsicHeight;
        assert.ok(Math.abs(ratio - expected) / expected < 0.04, `ratio ${ratio} expected ${expected}`);
        const overflows = await page.locator("#viewer").evaluate((dialog) => {
          const node = dialog as HTMLDialogElement;
          return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
        });
        assert.equal(overflows, false);
        const dialogBox = await page.locator("#viewer").boundingBox();
        assert.ok(dialogBox);
        for (const selector of ["#close", "#prev", "#next"]) {
          const control = await page.locator(selector).boundingBox();
          assert.ok(control, selector);
          assert.ok(control.width >= 44 && control.height >= 44, selector);
          assert.ok(control.x >= dialogBox.x - 1 && control.y >= dialogBox.y - 1, selector);
          assert.ok(control.x + control.width <= dialogBox.x + dialogBox.width + 1, selector);
          assert.ok(control.y + control.height <= dialogBox.y + dialogBox.height + 1, selector);
          assert.ok(control.x + control.width <= viewport.width + 1, selector);
          assert.ok(control.y + control.height <= viewport.height + 1, selector);
        }
        const closeBox = await page.locator("#close").boundingBox();
        assert.ok(closeBox);
        assert.ok(closeBox.x + closeBox.width >= dialogBox.x + dialogBox.width - 16);
        assert.ok(closeBox.y <= dialogBox.y + 16);
        const background = await page.locator("#close").evaluate((element) => getComputedStyle(element).backgroundColor);
        assert.notEqual(background, "rgba(0, 0, 0, 0)");
      };

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(server.baseUrl + "/", { waitUntil: "networkidle" });
      await page.waitForSelector("figcaption");
      await page.evaluate(() => {
        document.body.style.minHeight = "4000px";
        window.scrollTo(0, 360);
      });
      const scrollBefore = await page.evaluate(() => window.scrollY);
      assert.equal(scrollBefore, 360);

      const opener = page.locator("figure button").nth(1);
      await opener.evaluate((element: HTMLButtonElement) => element.click());
      await page.waitForSelector("dialog[open]");
      assert.equal(await page.locator("#full-label").innerText(), "tall · mobile");
      assert.equal(await page.locator("#prev").isDisabled(), false);
      assert.equal(await page.locator("#next").isDisabled(), false);
      await assertFitted(portrait.width, portrait.height);

      await page.locator("#prev").click();
      assert.equal(await page.locator("#full-label").innerText(), "wide · desktop");
      assert.equal(await page.locator("#prev").isDisabled(), true);
      assert.equal(await page.locator("#next").isDisabled(), false);
      await assertFitted(landscape.width, landscape.height);
      await page.locator("#prev").click({ force: true });
      assert.equal(await page.locator("#full-label").innerText(), "wide · desktop");

      await page.keyboard.press("ArrowRight");
      assert.equal(await page.locator("#full-label").innerText(), "tall · mobile");
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.locator("#full-label").innerText(), "square · tablet");
      assert.equal(await page.locator("#next").isDisabled(), true);
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.locator("#full-label").innerText(), "square · tablet");
      await assertFitted(1400, 1400);
      await page.keyboard.press("ArrowLeft");
      assert.equal(await page.locator("#full-label").innerText(), "tall · mobile");

      await page.setViewportSize({ width: 768, height: 1024 });
      await assertFitted(portrait.width, portrait.height);
      await page.keyboard.press("ArrowLeft");
      await assertFitted(landscape.width, landscape.height);

      await page.setViewportSize({ width: 844, height: 390 });
      await assertFitted(landscape.width, landscape.height);
      await page.keyboard.press("ArrowRight");
      await assertFitted(portrait.width, portrait.height);

      await page.setViewportSize({ width: 390, height: 844 });
      await assertFitted(portrait.width, portrait.height);
      for (const selector of ["#close", "#prev", "#next"]) {
        const control = await page.locator(selector).boundingBox();
        assert.ok(control && control.width >= 44 && control.height >= 44);
      }

      await page.locator("#close").focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true);

      await opener.evaluate((element: HTMLButtonElement) => element.click());
      await page.waitForSelector("dialog[open]");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
    } finally {
      await browser?.close();
      await server.close();
    }
  });
});
