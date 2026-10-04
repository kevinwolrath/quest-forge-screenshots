import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBrokenVisibleImage,
  shouldWaitForImage,
} from "../capture/prepare-page.ts";

describe("shouldWaitForImage", () => {
  const viewport = { width: 390, height: 844 };

  it("does not wait for complete images", () => {
    assert.equal(
      shouldWaitForImage(
        {
          complete: true,
          loading: null,
          top: 0,
          left: 0,
          bottom: 10,
          right: 10,
        },
        viewport,
      ),
      false,
    );
  });

  it("waits for incomplete eager images", () => {
    assert.equal(
      shouldWaitForImage(
        {
          complete: false,
          loading: null,
          top: 0,
          left: 0,
          bottom: 10,
          right: 10,
        },
        viewport,
      ),
      true,
    );
  });

  it("waits for incomplete lazy images inside the viewport", () => {
    assert.equal(
      shouldWaitForImage(
        {
          complete: false,
          loading: "lazy",
          top: 10,
          left: 10,
          bottom: 100,
          right: 100,
        },
        viewport,
      ),
      true,
    );
  });

  it("does not wait for incomplete lazy images outside the viewport", () => {
    assert.equal(
      shouldWaitForImage(
        {
          complete: false,
          loading: "lazy",
          top: 2000,
          left: 0,
          bottom: 2100,
          right: 100,
        },
        viewport,
      ),
      false,
    );
  });
});

describe("isBrokenVisibleImage", () => {
  const viewport = { width: 390, height: 844 };

  it("flags complete visible images with naturalWidth 0 as broken", () => {
    assert.equal(
      isBrokenVisibleImage(
        {
          complete: true,
          naturalWidth: 0,
          loading: null,
          top: 0,
          left: 0,
          bottom: 20,
          right: 20,
        },
        viewport,
      ),
      true,
    );
  });

  it("does not flag successfully loaded visible images", () => {
    assert.equal(
      isBrokenVisibleImage(
        {
          complete: true,
          naturalWidth: 32,
          loading: null,
          top: 0,
          left: 0,
          bottom: 20,
          right: 20,
        },
        viewport,
      ),
      false,
    );
  });

  it("does not flag off-screen lazy images even when complete with naturalWidth 0", () => {
    assert.equal(
      isBrokenVisibleImage(
        {
          complete: true,
          naturalWidth: 0,
          loading: "lazy",
          top: 2000,
          left: 0,
          bottom: 2100,
          right: 100,
        },
        viewport,
      ),
      false,
    );
  });
});
