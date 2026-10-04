import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Fixture verification inside the capture image.
 * This does not capture QuestForge and does not run on .45.
 *
 * Output and artifact files go to a temporary directory and a unique Compose
 * project. The normal screenshot-output/ and screenshot-artifact/ folders,
 * including any capture lock, are not mounted or deleted.
 *
 * Checks:
 * - desktop, tablet, and mobile PNGs against the local fixture
 * - failed capture exits 1
 * - managed output cleanup keeps unrelated files inside the temporary output
 * - artifact staging copies only the current manifest and successful PNGs
 * - pre-existing production output and artifact files survive success and failure
 */

const root = path.resolve(import.meta.dirname, "..");
const productionOutput = path.join(root, "screenshot-output");
const productionArtifact = path.join(root, "screenshot-artifact");

const unverifiedChecks = [
  "desktop, tablet, and mobile fixture capture inside Docker",
  "failed-capture exit status inside Docker",
  "managed output cleanup and artifact staging inside Docker",
  "production screenshot folders survive fixture verification",
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

type Fingerprint = {
  outputExists: boolean;
  artifactExists: boolean;
  files: Map<string, string>;
};

type Plant = {
  file: string;
  contents: string;
  createdDirs: string[];
};

type FixtureWorkspace = {
  tempRoot: string;
  outputDir: string;
  artifactDir: string;
  overridePath: string;
  projectName: string;
};

type ComposeVolume = {
  source?: string;
  target?: string;
};

const expectedViewports = [
  { viewportId: "desktop", width: 1440, height: 900 },
  { viewportId: "tablet", width: 768, height: 1024 },
  { viewportId: "mobile", width: 390, height: 844 },
];

let imageReady = false;
let workspace: FixtureWorkspace | null = null;
let originalProduction: Fingerprint | null = null;
let planted: Plant[] = [];

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }
  return String((error as { code: unknown }).code);
}

function runDocker(
  args: string[],
  capture: boolean,
): Promise<CommandResult> {
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

function yamlSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertDisposableTemp(dir: string): void {
  const resolved = path.resolve(dir);
  const forbidden = [path.resolve(root), productionOutput, productionArtifact];
  if (forbidden.includes(resolved)) {
    throw new Error(`refusing to delete or mount production path ${resolved}`);
  }
  const relativeToTemp = path.relative(path.resolve(os.tmpdir()), resolved);
  if (
    !relativeToTemp ||
    relativeToTemp.startsWith("..") ||
    path.isAbsolute(relativeToTemp)
  ) {
    throw new Error(`fixture workspace must stay under the system temp directory: ${resolved}`);
  }
}

function composeArgs(current: FixtureWorkspace): string[] {
  return [
    "compose",
    "--project-name",
    current.projectName,
    "--project-directory",
    root,
    "-f",
    path.join(root, "compose.yaml"),
    "-f",
    current.overridePath,
  ];
}

async function createWorkspace(): Promise<FixtureWorkspace> {
  const tempRoot = await mkdtempSafe();
  const outputDir = path.join(tempRoot, "output");
  const artifactDir = path.join(tempRoot, "artifact");
  await mkdir(outputDir);
  await mkdir(artifactDir);
  const projectName = `qfsfixture${process.pid}x${randomBytes(4).toString("hex")}`;
  assert.notEqual(projectName, "questforge-screenshot-capture");
  const overridePath = path.join(tempRoot, "compose.override.yaml");
  const outputMount = outputDir.split(path.sep).join("/");
  const artifactMount = artifactDir.split(path.sep).join("/");
  await writeFile(
    overridePath,
    [
      "services:",
      "  capture:",
      "    volumes:",
      "      - type: bind",
      `        source: ${yamlSingleQuote(outputMount)}`,
      "        target: /output",
      "      - type: bind",
      `        source: ${yamlSingleQuote(artifactMount)}`,
      "        target: /artifact",
      "",
    ].join("\n"),
    "utf8",
  );
  return { tempRoot, outputDir, artifactDir, overridePath, projectName };
}

async function mkdtempSafe(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "qfs-fixture-"));
  assertDisposableTemp(tempRoot);
  return tempRoot;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function fingerprintProduction(): Promise<Fingerprint> {
  const files = new Map<string, string>();
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const bytes = await readFile(absolute);
        files.set(absolute, createHash("sha256").update(bytes).digest("hex"));
      }
    }
  }

  const outputExists = await exists(productionOutput);
  const artifactExists = await exists(productionArtifact);
  if (outputExists) {
    await walk(productionOutput);
  }
  if (artifactExists) {
    await walk(productionArtifact);
  }
  return { outputExists, artifactExists, files };
}

async function mkdirTracked(dir: string, created: string[]): Promise<void> {
  const missing: string[] = [];
  let current = path.resolve(dir);
  const stop = path.resolve(root);
  while (current !== stop) {
    if (await exists(current)) {
      break;
    }
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  await mkdir(dir, { recursive: true });
  created.push(...missing);
}

async function plantFile(file: string, contents: string): Promise<Plant | null> {
  if (await exists(file)) {
    return null;
  }
  const createdDirs: string[] = [];
  await mkdirTracked(path.dirname(file), createdDirs);
  await writeFile(file, contents, { encoding: "utf8", flag: "wx" });
  return { file, contents, createdDirs };
}

async function plantRegressionFiles(): Promise<void> {
  const specs = [
    [path.join(productionOutput, "regression-keep.txt"), "keep-output\n"],
    [path.join(productionOutput, "home", "regression-keep.png"), "keep-png"],
    [path.join(productionOutput, ".capture.lock"), "regression-sentinel\n"],
    [path.join(productionArtifact, "regression-keep.txt"), "keep-artifact\n"],
    [path.join(productionArtifact, "nested", "regression-keep.txt"), "keep-nested\n"],
  ] as const;
  for (const [file, contents] of specs) {
    const plant = await plantFile(file, contents);
    if (plant) {
      planted.push(plant);
    }
  }
}

async function assertProductionSurvived(
  original: Fingerprint,
  plants: Plant[],
): Promise<void> {
  const current = await fingerprintProduction();
  for (const [file, hash] of original.files) {
    assert.equal(current.files.get(file), hash, `production file changed: ${file}`);
  }
  const plantedFiles = new Set(plants.map((plant) => plant.file));
  for (const file of current.files.keys()) {
    if (!original.files.has(file) && !plantedFiles.has(file)) {
      assert.fail(`unexpected production file created: ${file}`);
    }
  }
  for (const plant of plants) {
    assert.equal(await readFile(plant.file, "utf8"), plant.contents, plant.file);
  }
}

async function unplant(plants: Plant[]): Promise<void> {
  for (const plant of plants) {
    if (!(await exists(plant.file))) {
      continue;
    }
    const current = await readFile(plant.file, "utf8");
    if (current !== plant.contents) {
      continue;
    }
    await rm(plant.file, { force: true });
  }

  const createdDirs = [...new Set(plants.flatMap((plant) => plant.createdDirs))].sort(
    (left, right) => right.length - left.length,
  );
  for (const dir of createdDirs) {
    if (dir === productionOutput || dir === productionArtifact || dir === root) {
      const entries = await readdir(dir).catch(() => null);
      if (!entries || entries.length > 0) {
        continue;
      }
    }
    try {
      await rm(dir, { recursive: false, force: true });
    } catch (error) {
      if (errorCode(error) !== "ENOTEMPTY" && errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }
}

async function assertRestored(original: Fingerprint): Promise<void> {
  const current = await fingerprintProduction();
  assert.equal(current.outputExists, original.outputExists);
  assert.equal(current.artifactExists, original.artifactExists);
  assert.equal(current.files.size, original.files.size);
  for (const [file, hash] of original.files) {
    assert.equal(current.files.get(file), hash, `production file changed: ${file}`);
  }
}

async function assertTemporaryMounts(current: FixtureWorkspace): Promise<void> {
  const config = await runDocker([...composeArgs(current), "config", "--format", "json"], true);
  if (config.code !== 0) {
    throw new Error(config.stderr || "docker compose config failed");
  }
  const parsed = JSON.parse(config.stdout) as {
    name?: string;
    services?: { capture?: { volumes?: ComposeVolume[] } };
  };
  assert.equal(parsed.name, current.projectName);
  const volumes = parsed.services?.capture?.volumes ?? [];
  const byTarget = new Map(
    volumes.map((volume) => [volume.target, path.resolve(volume.source ?? "")]),
  );
  assert.equal(byTarget.get("/output"), path.resolve(current.outputDir));
  assert.equal(byTarget.get("/artifact"), path.resolve(current.artifactDir));
  assert.equal(byTarget.get("/config"), path.resolve(root, "config"));
  for (const source of byTarget.values()) {
    assert.notEqual(source, productionOutput);
    assert.notEqual(source, productionArtifact);
  }
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

async function readManifest(outputDir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8")) as Manifest;
}

async function clearTempMounts(current: FixtureWorkspace): Promise<void> {
  const cleared = await runDocker(
    [
      ...composeArgs(current),
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
    throw new Error(cleared.stderr || "failed to reset temporary capture directories");
  }
}

async function seedOutput(outputDir: string): Promise<void> {
  await mkdir(path.join(outputDir, "home"), { recursive: true });
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

async function assertUnrelatedFilesKept(outputDir: string): Promise<void> {
  assert.equal(
    await readFile(path.join(outputDir, "home", "keep-unrelated.png"), "utf8"),
    "keep",
  );
  assert.equal(await readFile(path.join(outputDir, "notes.txt"), "utf8"), "keep");
}

function reportDockerUnavailable(message: string): void {
  console.error(message);
  console.error("Docker is unavailable. Unverified checks:");
  for (const check of unverifiedChecks) {
    console.error(`- ${check}`);
  }
  process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log("DOCKER FIXTURE VERIFICATION (not QuestForge, not a .45 run)");
  originalProduction = await fingerprintProduction();
  await plantRegressionFiles();

  let info: CommandResult;
  try {
    info = await runDocker(["info", "--format", "{{.OSType}}"], true);
  } catch (error) {
    reportDockerUnavailable(error instanceof Error ? error.message : String(error));
    return;
  }

  if (info.code !== 0) {
    reportDockerUnavailable(info.stderr || info.stdout || "docker info failed");
    return;
  }

  const osType = info.stdout.trim();
  assert.equal(osType, "linux", `capture image requires Linux containers, got ${osType}`);

  const current = await createWorkspace();
  workspace = current;
  await assertTemporaryMounts(current);

  const build = await runDocker([...composeArgs(current), "build", "capture"], false);
  assert.equal(build.code, 0, "docker compose build capture failed");
  imageReady = true;

  const browser = await runDocker(
    [
      ...composeArgs(current),
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

  await seedOutput(current.outputDir);
  const fixture = await runDocker(
    [
      ...composeArgs(current),
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

  const success = await readManifest(current.outputDir);
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
    const bytes = await readFile(path.join(current.outputDir, relativeFile));
    assert.equal(pngSignature(bytes), true, `${relativeFile} is not a PNG`);
    assert.notEqual(bytes.toString("utf8"), "stale");
  }
  await assertUnrelatedFilesKept(current.outputDir);
  await assertProductionSurvived(originalProduction, planted);

  const stageOk = await runDocker(
    [...composeArgs(current), "run", "--rm", "-T", "--no-deps", "capture", "stage-artifact"],
    false,
  );
  assert.equal(stageOk.code, 0, "artifact staging after fixture capture failed");
  assert.deepEqual(await listFiles(current.artifactDir), [
    ...expectedViewports.map((viewport) => expectedPng(viewport)),
    "manifest.json",
  ].sort());
  await assertProductionSurvived(originalProduction, planted);

  await clearTempMounts(current);
  await seedOutput(current.outputDir);
  const failed = await runDocker(
    [
      ...composeArgs(current),
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

  const failure = await readManifest(current.outputDir);
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
    await assert.rejects(() => access(path.join(current.outputDir, expectedPng(viewport))));
  }
  await assertUnrelatedFilesKept(current.outputDir);
  await assertProductionSurvived(originalProduction, planted);

  const stageFailed = await runDocker(
    [...composeArgs(current), "run", "--rm", "-T", "--no-deps", "capture", "stage-artifact"],
    false,
  );
  assert.equal(stageFailed.code, 0, "artifact staging after failed capture failed");
  assert.deepEqual(await listFiles(current.artifactDir), ["manifest.json"]);
  await assertProductionSurvived(originalProduction, planted);

  console.log("Docker fixture verification passed.");
  console.log("Checked desktop, tablet, and mobile PNGs; failed-capture exit status 1;");
  console.log("managed-output cleanup; and artifact staging.");
  console.log("Production screenshot folders were left in place.");
  console.log("This was not a live QuestForge capture and not a .45 run.");
}

async function cleanupWorkspace(): Promise<void> {
  const current = workspace;
  if (!current) {
    return;
  }
  assertDisposableTemp(current.tempRoot);
  if (imageReady) {
    const cleared = await runDocker(
      [
        ...composeArgs(current),
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
      console.error(cleared.stderr || "temp mount cleanup failed");
    }
  }
  await rm(current.tempRoot, { recursive: true, force: true });
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupWorkspace();
      if (originalProduction) {
        await assertProductionSurvived(originalProduction, planted);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    } finally {
      try {
        await unplant(planted);
        if (originalProduction) {
          await assertRestored(originalProduction);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
      }
    }
  });
