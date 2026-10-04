import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, it } from "node:test";

import { startGallery, type GalleryNode } from "../src/gallery-client.ts";
import { galleryDocumentHtml } from "../src/gallery-page.ts";
import { LIMITS } from "../src/limits.ts";
import { galleryZip, PNG } from "./gallery-fixtures.ts";

class FakeNode implements GalleryNode {
  textContent = "";
  hidden = false;
  src = "";
  alt = "";
  type = "";
  open = false;
  children: FakeNode[] = [];
  private listeners = new Map<string, Array<() => void>>();

  append(child: GalleryNode): void {
    this.children.push(child as FakeNode);
  }

  setAttribute(): void {}

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

  showModal(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

class FakeDom {
  readonly nodes = new Map<string, FakeNode>();

  constructor() {
    for (const id of ["when", "status", "grid", "viewer", "full", "full-label", "close"]) {
      this.nodes.set(id, new FakeNode());
    }
  }

  getElementById(id: string): FakeNode | null {
    return this.nodes.get(id) ?? null;
  }

  createElement(): FakeNode {
    return new FakeNode();
  }
}

describe("flat gallery client", () => {
  it("unpacks one zip into a labeled grid and opens an image", async () => {
    const dom = new FakeDom();
    let calls = 0;
    await startGallery(
      dom,
      async (url) => {
        calls += 1;
        assert.equal(url, "/archive");
        const zip = galleryZip([
          { file: "images/home-desktop.png", screen: "home", viewport: "desktop", bytes: PNG },
          { file: "images/home-mobile.png", screen: "home", viewport: "mobile", bytes: PNG },
        ]);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
        };
      },
      LIMITS,
    );
    assert.equal(calls, 1);
    assert.equal(dom.nodes.get("when")?.textContent, "2026-10-04T12:00:00.000Z");
    assert.equal(dom.nodes.get("status")?.hidden, true);
    const grid = dom.nodes.get("grid");
    assert.equal(grid?.children.length, 2);
    assert.equal(grid?.children[0]?.children[0]?.children[1]?.textContent, "home · desktop");
    assert.equal(grid?.children[1]?.children[0]?.children[1]?.textContent, "home · mobile");
    grid?.children[1]?.children[0]?.click();
    assert.equal(dom.nodes.get("viewer")?.open, true);
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · mobile");
    dom.nodes.get("close")?.click();
    assert.equal(dom.nodes.get("viewer")?.open, false);
  });

  it("shows an empty state and rejects a bad archive without rendering images", async () => {
    const empty = new FakeDom();
    await startGallery(empty, async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }), LIMITS);
    assert.equal(empty.nodes.get("status")?.textContent, "No screenshots have been published yet.");
    assert.equal(empty.nodes.get("grid")?.children.length, 0);

    const bad = new FakeDom();
    await startGallery(
      bad,
      async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("not a zip").buffer,
      }),
      LIMITS,
    );
    assert.equal(bad.nodes.get("status")?.textContent, "The current archive could not be shown.");
    assert.equal(bad.nodes.get("grid")?.children.length, 0);
  });

  it("runs the script embedded in the page", async () => {
    const html = galleryDocumentHtml();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(script);
    const dom = new FakeDom();
    const zip = galleryZip();
    const sandbox = {
      document: dom,
      fetch: async (url: string) => {
        assert.equal(url, "/archive");
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
        };
      },
      URL: { createObjectURL: () => "blob:synthetic" },
      Blob,
      TextDecoder,
      TextEncoder,
      DecompressionStream,
      Uint8Array,
      Uint32Array,
      console,
    };
    const result = vm.runInNewContext(script!, sandbox) as Promise<void>;
    await result;
    assert.equal(dom.nodes.get("when")?.textContent, "2026-10-04T12:00:00.000Z");
    assert.equal(dom.nodes.get("grid")?.children.length, 1);
    assert.equal(dom.nodes.get("grid")?.children[0]?.children[0]?.children[1]?.textContent, "home · desktop");
  });
});
