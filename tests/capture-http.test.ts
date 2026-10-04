import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveCaptureOptions } from "../capture/config.ts";
import { runCapture } from "../capture/run.ts";

type RequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

async function withHttpServer(
  handler: RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("failed to bind test server");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("HTTP error capture", () => {
  it("marks HTTP error pages as failed and clears stale PNGs", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "http-capture-"));
    const configDir = await mkdtemp(path.join(os.tmpdir(), "http-config-"));
    const stalePath = path.join(outputDir, "home", "desktop-1440x900.png");

    await mkdir(path.join(outputDir, "home"), { recursive: true });
    await writeFile(stalePath, "stale-png");
    await writeFile(
      path.join(configDir, "screens.json"),
      JSON.stringify({
        screens: [{ id: "home", path: "/missing", readySelector: null }],
      }),
    );
    await writeFile(
      path.join(configDir, "viewports.json"),
      JSON.stringify({
        viewports: [
          {
            id: "desktop",
            width: 800,
            height: 600,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
          },
        ],
      }),
    );

    await withHttpServer((request, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
    }, async (baseUrl) => {
      const options = resolveCaptureOptions(
        {
          SCREENSHOT_BASE_URL: baseUrl,
          SCREENSHOT_OUTPUT_DIR: outputDir,
          SCREENSHOT_CONFIG_DIR: configDir,
        },
        root,
      );

      const manifest = await runCapture(options);
      assert.equal(manifest.summary.total, 1);
      assert.equal(manifest.summary.failed, 1);
      assert.equal(manifest.results[0]?.status, "failed");
      assert.match(manifest.results[0]?.error || "", /HTTP 404/);
      await assert.rejects(() => access(stalePath));
    });
  });
});
