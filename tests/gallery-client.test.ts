import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, it } from "node:test";

import { startGallery, type GalleryEvent, type GalleryNode } from "../src/gallery-client.ts";
import { galleryDocumentHtml } from "../src/gallery-page.ts";
import { LIMITS } from "../src/limits.ts";
import { galleryZip, PNG } from "./gallery-fixtures.ts";

class FakeNode implements GalleryNode {
  textContent = "";
  hidden = false;
  src = "";
  alt = "";
  type = "";
  disabled = false;
  scrollTop = 0;
  scrollLeft = 0;
  open = false;
  children: FakeNode[] = [];
  private dom: FakeDom | null = null;
  private classes = new Set<string>();
  readonly classList = {
    add: (token: string) => {
      this.classes.add(token);
    },
    remove: (token: string) => {
      this.classes.delete(token);
    },
    contains: (token: string) => this.classes.has(token),
  };
  private listeners = new Map<string, Array<(event?: GalleryEvent) => void>>();

  attach(dom: FakeDom): void {
    this.dom = dom;
  }

  append(child: GalleryNode): void {
    this.children.push(child as FakeNode);
  }

  setAttribute(): void {}

  addEventListener(type: string, listener: (event?: GalleryEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, event?: GalleryEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  click(): void {
    this.emit("click");
  }

  showModal(): void {
    this.open = true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.emit("close");
  }

  focus(): void {
    this.dom?.setActive(this);
  }
}

class FakeDom {
  readonly nodes = new Map<string, FakeNode>();
  activeElement: FakeNode | null = null;

  constructor() {
    for (const id of ["when", "status", "grid", "viewer", "full", "full-label", "close", "prev", "next"]) {
      const node = new FakeNode();
      node.attach(this);
      this.nodes.set(id, node);
    }
  }

  setActive(node: FakeNode): void {
    this.activeElement = node;
  }

  getElementById(id: string): FakeNode | null {
    return this.nodes.get(id) ?? null;
  }

  createElement(): FakeNode {
    const node = new FakeNode();
    node.attach(this);
    return node;
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
    const opener = grid?.children[1]?.children[0];
    opener?.click();
    assert.equal(dom.nodes.get("viewer")?.open, true);
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · mobile");
    assert.equal(dom.nodes.get("full")?.alt, "home · mobile");
    assert.equal(dom.nodes.get("prev")?.disabled, false);
    assert.equal(dom.nodes.get("next")?.disabled, true);
    assert.equal(dom.activeElement, dom.nodes.get("close"));
    assert.equal(dom.nodes.get("viewer")?.classList.contains("is-actual"), false);

    const viewer = dom.nodes.get("viewer");
    const full = dom.nodes.get("full");
    viewer?.emit("click", { target: full });
    assert.equal(viewer?.classList.contains("is-actual"), true);
    viewer?.emit("click", { target: dom.nodes.get("close") });
    viewer?.emit("click", { target: dom.nodes.get("prev") });
    assert.equal(viewer?.classList.contains("is-actual"), true);
    viewer?.emit("keydown", { key: "ArrowLeft" });
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · desktop");
    assert.equal(viewer?.classList.contains("is-actual"), true);
    full?.emit("keydown", { key: "Enter" });
    assert.equal(viewer?.classList.contains("is-actual"), false);
    viewer?.emit("keydown", { key: "ArrowRight" });
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · mobile");

    dom.nodes.get("prev")?.click();
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · desktop");
    assert.equal(dom.nodes.get("prev")?.disabled, true);
    assert.equal(dom.nodes.get("next")?.disabled, false);
    dom.nodes.get("prev")?.click();
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · desktop");

    dom.nodes.get("viewer")?.emit("keydown", { key: "ArrowRight" });
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · mobile");
    assert.equal(dom.nodes.get("next")?.disabled, true);
    dom.nodes.get("viewer")?.emit("keydown", { key: "ArrowRight" });
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · mobile");
    dom.nodes.get("viewer")?.emit("keydown", { key: "ArrowLeft" });
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · desktop");
    dom.nodes.get("next")?.focus();
    dom.nodes.get("viewer")?.emit("keydown", { key: "ArrowRight" });
    assert.equal(dom.nodes.get("full-label")?.textContent, "home · mobile");
    assert.equal(dom.nodes.get("next")?.disabled, true);
    assert.equal(dom.activeElement, dom.nodes.get("close"));
    dom.nodes.get("close")?.click();
    assert.equal(dom.nodes.get("viewer")?.open, false);
    assert.equal(dom.activeElement, opener);

    const scroll = globalThis as { scrollY?: number; scrollTo?: (x: number, y: number) => void };
    const previousScrollY = scroll.scrollY;
    const previousScrollTo = scroll.scrollTo;
    let restored = -1;
    scroll.scrollY = 480;
    scroll.scrollTo = (_x, y) => {
      restored = y;
    };
    try {
      grid?.children[0]?.children[0]?.click();
      assert.equal(dom.nodes.get("full-label")?.textContent, "home · desktop");
      dom.nodes.get("close")?.click();
      assert.equal(dom.nodes.get("viewer")?.open, false);
      assert.equal(dom.activeElement, grid?.children[0]?.children[0]);
      assert.equal(restored, 480);
    } finally {
      if (previousScrollY === undefined) delete scroll.scrollY;
      else scroll.scrollY = previousScrollY;
      if (previousScrollTo === undefined) delete scroll.scrollTo;
      else scroll.scrollTo = previousScrollTo;
    }
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
    dom.nodes.get("grid")?.children[0]?.children[0]?.click();
    assert.equal(dom.nodes.get("viewer")?.open, true);
    assert.equal(dom.nodes.get("prev")?.disabled, true);
    assert.equal(dom.nodes.get("next")?.disabled, true);
    assert.equal(dom.activeElement, dom.nodes.get("close"));
    dom.nodes.get("close")?.click();
    assert.equal(dom.nodes.get("viewer")?.open, false);
    assert.equal(dom.activeElement, dom.nodes.get("grid")?.children[0]?.children[0]);
  });
});
