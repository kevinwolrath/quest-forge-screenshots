import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fixture verification inside the capture image.
 * This does not capture QuestForge and does not run on .45.
 *
 * Checks:
 * - desktop, tablet, and mobile PNGs against the local fixture
 * - failed capture exits 1
 * - managed output cleanup keeps unrelated files
 * - artifact staging uploads only the current manifest and successful PNGs
 */

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "screenshot-output");
const artifactDir = path.join(root, "screenshot-artifact");
let imageReady = false;

const unverifiedChecks = [
  "desktop, tablet, and mobile fixture capture inside Docker",
  "failed-capture exit status inside Docker",
  "managed output cleanup and artifact staging inside Docker",
];

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type ManifestResult = {
  viewportId: string;
  width: number;
  height: number;
  status: string;
  file: string | null;
};

type Manifest = {
  baseUrl: string;
  appCommitSha: string | null;
  appCommitShaVerified: boolean;
  outputDir: string;
  summary: { total: number; ok: number; failed: number };
  results: ManifestResult[];
};

const expectedViewports = [
  { viewportId: "desktop", width: 1440, height: 900 },
  { viewportId: "tablet", width: 768, height: 1024 },
  { viewportId: "mobile", width: 390, height: 844 },
];

function runDocker(args: string[], capture: boolean): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: root,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("docker command not found"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function pngSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
}

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        found.push(path.relative(directory, absolute).split(path.sep).join("/"));
      }
    }
  }
  await walk(directory);
  found.sort();
  return found;
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8")) as Manifest;
}

async function resetMounts(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  const cleared = await runDocker(
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "--entrypoint",
      "sh",
      "capture",
      "-c",
      "find /output /artifact -mindepth 1 -delete",
    ],
    true,
  );
  if (cleared.code !== 0) {
    throw new Error(cleared.stderr || "failed to reset mounted capture directories");
  }
}

async function seedOutput(): Promise<void> {
  await resetMounts();
  await mkdir(path.join(outputDir, "home"), { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(outputDir, "home", "desktop-1440x900.png"), "stale");
  await writeFile(path.join(outputDir, "home", "keep-unrelated.png"), "keep");
  await writeFile(path.join(outputDir, "notes.txt"), "keep");
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(
      {
        capturedAt: "2026-01-01T00:00:00.000Z",
        baseUrl: "http://example.test",
        appCommitSha: null,
        appCommitShaVerified: false,
        outputDir: "/output",
        viewports: [],
        routes: [],
        results: [
          {
            screenId: "home",
            path: "/",
            viewportId: "desktop",
            width: 1440,
            height: 900,
            file: "home/desktop-1440x900.png",
            status: "ok",
            error: null,
          },
        ],
        summary: { total: 1, ok: 1, failed: 0 },
      },
      null,
      2,
    )}\n`,
  );
}

function expectedPng(viewport: { viewportId: string; width: number; height: number }): string {
  return `home/${viewport.viewportId}-${viewport.width}x${viewport.height}.png`;
}

async function assertUnrelatedFilesKept(): Promise<void> {
  assert.equal(
    await readFile(path.join(outputDir, "home", "keep-unrelated.png"), "utf8"),
    "keep",
  );
  assert.equal(await readFile(path.join(outputDir, "notes.txt"), "utf8"), "keep");
}

async function main(): Promise<void> {
  console.log("DOCKER FIXTURE VERIFICATION (not QuestForge, not a .45 run)");

  let info: CommandResult;
  try {
    info = await runDocker(["info", "--format", "{{.OSType}}"], true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error("Docker is unavailable. Unverified checks:");
    for (const check of unverifiedChecks) {
      console.error(`- ${check}`);
    }
    process.exitCode = 1;
    return;
  }

  if (info.code !== 0) {
    console.error(info.stderr || info.stdout || "docker info failed");
    console.error("Docker is unavailable. Unverified checks:");
    for (const check of unverifiedChecks) {
      console.error(`- ${check}`);
    }
    process.exitCode = 1;
    return;
  }

  const osType = info.stdout.trim();
  assert.equal(osType, "linux", `capture image requires Linux containers, got ${osType}`);

  await mkdir(outputDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const build = await runDocker(["compose", "build", "capture"], false);
  assert.equal(build.code, 0, "docker compose build capture failed");
  imageReady = true;

  const browser = await runDocker(
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "--entrypoint",
      "node",
      "capture",
      "--input-type=module",
      "-e",
      "import { chromium } from 'playwright'; const browserPath = chromium.executablePath(); if (!browserPath.includes('/ms-playwright/')) { console.error(browserPath); process.exit(1); } console.log(browserPath);",
    ],
    true,
  );
  if (browser.code !== 0) {
    console.error(browser.stderr);
    console.error(browser.stdout);
  }
  assert.equal(browser.code, 0, "Chromium is not the browser baked into the Playwright image");
  assert.match(browser.stdout, /\/ms-playwright\//);

  await seedOutput();
  const fixture = await runDocker(
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "-e",
      "SCREENSHOT_APP_COMMIT_SHA=fixture-docker",
      "capture",
      "capture:fixture",
    ],
    false,
  );
  assert.equal(fixture.code, 0, "fixture capture inside Docker failed");

  const success = await readManifest();
  assert.equal(success.outputDir, "/output");
  assert.equal(success.appCommitSha, "fixture-docker");
  assert.equal(success.appCommitShaVerified, false);
  assert.match(success.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(success.summary.total, 3);
  assert.equal(success.summary.ok, 3);
  assert.equal(success.summary.failed, 0);
  assert.deepEqual(
    success.results.map((result) => ({
      viewportId: result.viewportId,
      width: result.width,
      height: result.height,
      status: result.status,
    })),
    expectedViewports.map((viewport) => ({ ...viewport, status: "ok" })),
  );

  for (const viewport of expectedViewports) {
    const relativeFile = expectedPng(viewport);
    const result = success.results.find((item) => item.viewportId === viewport.viewportId);
    assert.equal(result?.file, relativeFile);
    const bytes = await readFile(path.join(outputDir, relativeFile));
    assert.equal(pngSignature(bytes), true, `${relativeFile} is not a PNG`);
    assert.notEqual(bytes.toString("utf8"), "stale");
  }
  await assertUnrelatedFilesKept();

  const stageOk = await runDocker(
    ["compose", "run", "--rm", "-T", "--no-deps", "capture", "stage-artifact"],
    false,
  );
  assert.equal(stageOk.code, 0, "artifact staging after fixture capture failed");
  assert.deepEqual(await listFiles(artifactDir), [
    ...expectedViewports.map((viewport) => expectedPng(viewport)),
    "manifest.json",
  ].sort());

  await seedOutput();
  const failed = await runDocker(
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "-e",
      "SCREENSHOT_BASE_URL=http://127.0.0.1:9",
      "-e",
      "SCREENSHOT_NAVIGATION_TIMEOUT_MS=5000",
      "-e",
      "SCREENSHOT_READY_TIMEOUT_MS=5000",
      "-e",
      "SCREENSHOT_APP_COMMIT_SHA=fixture-docker-fail",
      "capture",
    ],
    false,
  );
  assert.equal(failed.code, 1, "failed capture should exit 1");

  const failure = await readManifest();
  assert.equal(failure.baseUrl, "http://127.0.0.1:9");
  assert.equal(failure.appCommitSha, "fixture-docker-fail");
  assert.equal(failure.appCommitShaVerified, false);
  assert.equal(failure.summary.total, 3);
  assert.equal(failure.summary.ok, 0);
  assert.equal(failure.summary.failed, 3);
  assert.deepEqual(
    failure.results.map((result) => ({
      viewportId: result.viewportId,
      width: result.width,
      height: result.height,
      status: result.status,
      file: result.file,
    })),
    expectedViewports.map((viewport) => ({ ...viewport, status: "failed", file: null })),
  );
  for (const viewport of expectedViewports) {
    await assert.rejects(() => access(path.join(outputDir, expectedPng(viewport))));
  }
  await assertUnrelatedFilesKept();

  const stageFailed = await runDocker(
    ["compose", "run", "--rm", "-T", "--no-deps", "capture", "stage-artifact"],
    false,
  );
  assert.equal(stageFailed.code, 0, "artifact staging after failed capture failed");
  assert.deepEqual(await listFiles(artifactDir), ["manifest.json"]);

  console.log("Docker fixture verification passed.");
  console.log("Checked desktop, tablet, and mobile PNGs; failed-capture exit status 1;");
  console.log("managed-output cleanup; and artifact staging.");
  console.log("This was not a live QuestForge capture and not a .45 run.");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (imageReady) {
      try {
        await resetMounts();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`cleanup failed: ${message}`);
      }
    }
    await rm(outputDir, { recursive: true, force: true }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`cleanup failed: ${message}`);
    });
    await rm(artifactDir, { recursive: true, force: true }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`cleanup failed: ${message}`);
    });
  });
