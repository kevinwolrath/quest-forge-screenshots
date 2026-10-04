import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveManagedOutputPath } from "../capture/paths.ts";

describe("resolveManagedOutputPath", () => {
  it("resolves a normal relative capture path", () => {
    const outputDir = path.resolve("/tmp/screenshot-output");
    const absolute = resolveManagedOutputPath(
      outputDir,
      "home/desktop-1440x900.png",
    );
    assert.equal(absolute, path.join(outputDir, "home", "desktop-1440x900.png"));
  });

  it("rejects path escape via .. segments", () => {
    assert.throws(
      () =>
        resolveManagedOutputPath(
          path.resolve("/tmp/screenshot-output"),
          "../outside.png",
        ),
      /escape|'\.\.'/,
    );
  });

  it("rejects absolute screenshot paths", () => {
    assert.throws(
      () =>
        resolveManagedOutputPath(
          path.resolve("/tmp/screenshot-output"),
          "/etc/passwd.png",
        ),
      /relative path/,
    );
  });
});
