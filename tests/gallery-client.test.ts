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
  value = "";
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

  attributes = new Map<string, string>();

  append(child: GalleryNode): void {
    this.children.push(child as unknown as FakeNode);
  }

  replaceChildren(): void {
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

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
    for (const id of ["when", "status", "grid", "viewer", "full", "full-label", "close", "prev", "next", "view", "merge-details", "merge-title", "merge-meta"]) {
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

function zipResponse(zip: Uint8Array) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
  };
}

function jsonResponse(body: unknown, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return { ok: status === 200, status, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer };
}

describe("flat gallery client", () => {
  it("unpacks one zip into a labeled grid and opens an image", async () => {
    const dom = new FakeDom();
    const calls: string[] = [];
    await startGallery(
      dom,
      async (url) => {
        calls.push(url);
        if (url === "/api/merges") return jsonResponse({ merges: [] });
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
    assert.deepEqual(calls, ["/archive", "/api/merges"]);
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
        if (url === "/api/merges") return jsonResponse({ merges: [] });
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

  it("switches between the develop gallery and the last merges, showing only the merge's screens", async () => {
    const A = "pr-12-0123456789ab";
    const B = "pr-11-ba9876543210";
    const merge = (id: string, number: number, title: string) => ({
      id,
      kind: "merge",
      pr: { number, title },
      mergeCommit: id.slice(-12) + "c".repeat(28),
      mergedAt: "2026-10-08T09:00:00Z",
      screens: ["c03-characters"],
      viewports: ["desktop"],
      generatedAt: "2026-10-08T09:10:00.000Z",
      images: 1,
    });
    const develop = galleryZip([
      { file: "images/home-desktop.png", screen: "home", viewport: "desktop", bytes: PNG },
      { file: "images/home-mobile.png", screen: "home", viewport: "mobile", bytes: PNG },
    ]);
    const snapshot = (id: string) =>
      galleryZip([{ file: "images/c03-characters-desktop.png", screen: "c03-characters", viewport: "desktop 1440x900", bytes: PNG }], {
        snapshot: { id },
      });
    let pending: ((value: ReturnType<typeof zipResponse>) => void) | null = null;
    const calls: string[] = [];
    const dom = new FakeDom();
    await startGallery(
      dom,
      async (url) => {
        calls.push(url);
        if (url === "/archive") return zipResponse(develop);
        if (url === "/api/merges") {
          return jsonResponse({ merges: [merge(A, 12, "Change twelve"), { id: "../etc", pr: { number: 1, title: "bad" } }, merge(B, 11, "Change eleven")] });
        }
        if (url === `/merges/${A}/archive`) return zipResponse(snapshot(A));
        if (url === `/merges/${B}/archive`) return new Promise((resolve) => (pending = resolve));
        return jsonResponse({}, 404);
      },
      LIMITS,
    );
    const view = dom.nodes.get("view")!;
    const grid = dom.nodes.get("grid")!;
    const details = dom.nodes.get("merge-details")!;
    const group = view.children[0]!;
    assert.equal(group.attributes.get("label"), "Last 10 merges");
    assert.deepEqual(
      group.children.map((option) => [option.value, option.textContent]),
      [
        [A, "#12 · Change twelve"],
        [B, "#11 · Change eleven"],
      ],
    );
    assert.equal(grid.children.length, 2);

    view.value = A;
    view.emit("change");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(details.hidden, false);
    assert.equal(dom.nodes.get("merge-title")?.textContent, "PR #12: Change twelve");
    assert.match(dom.nodes.get("merge-meta")?.textContent ?? "", /^Merged 2026-10-08T09:00:00Z as 0123456 · Screens: c03-characters$/);
    assert.deepEqual(
      grid.children.map((figure) => figure.children[0]?.children[1]?.textContent),
      ["c03-characters · desktop 1440x900"],
    );

    // A slow merge loses to a newer choice: going back to develop wins.
    view.value = B;
    view.emit("change");
    view.value = "develop";
    view.emit("change");
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending!(zipResponse(snapshot(B)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(details.hidden, true);
    assert.deepEqual(
      grid.children.map((figure) => figure.children[0]?.children[1]?.textContent),
      ["home · desktop", "home · mobile"],
    );
    assert.deepEqual(calls, ["/archive", "/api/merges", `/merges/${A}/archive`, `/merges/${B}/archive`, "/archive"]);
  });

  it("refuses a merge archive for another merge, and says when history is missing", async () => {
    const A = "pr-12-0123456789ab";
    const dom = new FakeDom();
    await startGallery(
      dom,
      async (url) => {
        if (url === "/archive") return zipResponse(galleryZip());
        if (url === "/api/merges") {
          return jsonResponse({
            merges: [
              {
                id: A,
                pr: { number: 12, title: "Change twelve" },
                mergeCommit: "0123456789ab" + "c".repeat(28),
                mergedAt: "2026-10-08T09:00:00Z",
                screens: ["home"],
              },
            ],
          });
        }
        // The archive at this merge's path claims to be another merge.
        return zipResponse(galleryZip(undefined, { snapshot: { id: "pr-13-0123456789ab" } }));
      },
      LIMITS,
    );
    const view = dom.nodes.get("view")!;
    view.value = A;
    view.emit("change");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(dom.nodes.get("status")?.textContent, "This merge snapshot could not be shown.");
    assert.equal(dom.nodes.get("grid")?.children.length, 0);

    const gone = new FakeDom();
    await startGallery(
      gone,
      async (url) => {
        if (url === "/archive") return zipResponse(galleryZip());
        if (url === "/api/merges") return jsonResponse({}, 503);
        return jsonResponse({}, 404);
      },
      LIMITS,
    );
    const option = gone.nodes.get("view")!.children[0]!.children[0]!;
    assert.equal(option.textContent, "Merge history could not be loaded");
    assert.equal(option.disabled, true);
    assert.equal(gone.nodes.get("grid")?.children.length, 1);

    // A develop archive that carries snapshot metadata is not the develop gallery.
    const mixed = new FakeDom();
    await startGallery(
      mixed,
      async (url) => (url === "/archive" ? zipResponse(galleryZip(undefined, { snapshot: { id: A } })) : jsonResponse({ merges: [] })),
      LIMITS,
    );
    assert.equal(mixed.nodes.get("status")?.textContent, "The current archive could not be shown.");
    assert.equal(mixed.nodes.get("view")!.children[0]!.children[0]!.textContent, "No merge snapshots yet");
  });
});
