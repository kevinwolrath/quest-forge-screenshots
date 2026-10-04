import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const realOutput = path.join(root, "screenshot-output");
const realArtifact = path.join(root, "screenshot-artifact");

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type TreeSnapshot = {
  outputExists: boolean;
  artifactExists: boolean;
  files: Map<string, string>;
};

function runVerifier(pathEnv: string, guardRoot: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/tsx/dist/cli.mjs"),
        path.join(root, "scripts/verify-docker-capture.ts"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: pathEnv,
          QFS_DOCKER_FIXTURE_GUARD_ROOT: guardRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function writeFakeDocker(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qfs-fake-docker-"));
  const dockerPath = path.join(dir, "docker");
  await writeFile(dockerPath, body, "utf8");
  await chmod(dockerPath, 0o755);
  return dir;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function snapshotTree(outputDir: string, artifactDir: string): Promise<TreeSnapshot> {
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

  const outputExists = await exists(outputDir);
  const artifactExists = await exists(artifactDir);
  if (outputExists) {
    await walk(outputDir);
  }
  if (artifactExists) {
    await walk(artifactDir);
  }
  return { outputExists, artifactExists, files };
}

function assertSameTree(before: TreeSnapshot, after: TreeSnapshot, label: string): void {
  assert.equal(after.outputExists, before.outputExists, label);
  assert.equal(after.artifactExists, before.artifactExists, label);
  assert.equal(after.files.size, before.files.size, label);
  for (const [file, hash] of before.files) {
    assert.equal(after.files.get(file), hash, `${label}: ${file}`);
  }
  for (const file of after.files.keys()) {
    assert.equal(before.files.has(file), true, `${label} created ${file}`);
  }
}

async function expectDockerFailures(guardRoot: string, bins: {
  missingDocker: string;
  infoFails: string;
  buildFails: string;
}): Promise<void> {
  const missing = await runVerifier(bins.missingDocker, guardRoot);
  assert.equal(missing.code, 1, missing.stderr);
  assert.match(missing.stderr, /docker command not found/);

  const unavailable = await runVerifier(bins.infoFails, guardRoot);
  assert.equal(unavailable.code, 1, unavailable.stderr);
  assert.match(unavailable.stderr, /Docker is unavailable/);

  const build = await runVerifier(
    `${bins.buildFails}${path.delimiter}${bins.missingDocker}`,
    guardRoot,
  );
  assert.equal(build.code, 1, `${build.stdout}\n${build.stderr}`);
  assert.match(
    `${build.stdout}\n${build.stderr}`,
    /simulated docker failure|docker compose config failed/,
  );
}

describe("docker fixture isolation", () => {
  it("does not create production files or a capture lock when none existed", async () => {
    const guardRoot = await mkdtemp(path.join(os.tmpdir(), "qfs-guard-empty-"));
    const guardOutput = path.join(guardRoot, "screenshot-output");
    const guardArtifact = path.join(guardRoot, "screenshot-artifact");
    const realBefore = await snapshotTree(realOutput, realArtifact);
    const missingDocker = await mkdtemp(path.join(os.tmpdir(), "qfs-no-docker-"));
    const infoFails = await writeFakeDocker(
      "#!/bin/sh\necho 'docker daemon unavailable' >&2\nexit 1\n",
    );
    const buildFails = await writeFakeDocker(
      "#!/bin/sh\nif [ \"$1\" = \"info\" ]; then\n  printf '%s\\n' linux\n  exit 0\nfi\necho 'simulated docker failure' >&2\nexit 1\n",
    );

    try {
      await expectDockerFailures(guardRoot, { missingDocker, infoFails, buildFails });

      assert.equal(await exists(guardOutput), false);
      assert.equal(await exists(guardArtifact), false);
      assert.equal(await exists(path.join(guardOutput, ".capture.lock")), false);
      assertSameTree(realBefore, await snapshotTree(realOutput, realArtifact), "real screenshot folders");
      assert.equal(
        (await snapshotTree(realOutput, realArtifact)).files.has(path.join(realOutput, ".capture.lock")),
        realBefore.files.has(path.join(realOutput, ".capture.lock")),
      );
    } finally {
      await rm(guardRoot, { recursive: true, force: true });
      await rm(missingDocker, { recursive: true, force: true });
      await rm(infoFails, { recursive: true, force: true });
      await rm(buildFails, { recursive: true, force: true });
    }
  });

  it("leaves an isolated pre-existing capture lock and screenshot files unchanged", async () => {
    const id = randomBytes(4).toString("hex");
    const guardRoot = await mkdtemp(path.join(os.tmpdir(), "qfs-guard-seeded-"));
    const guardOutput = path.join(guardRoot, "screenshot-output");
    const guardArtifact = path.join(guardRoot, "screenshot-artifact");
    const outputNote = path.join(guardOutput, `preexisting-output-${id}.txt`);
    const outputPng = path.join(guardOutput, "home", `preexisting-${id}.png`);
    const lockPath = path.join(guardOutput, ".capture.lock");
    const artifactNote = path.join(guardArtifact, "nested", `preexisting-artifact-${id}.txt`);
    const lockContents = `pid=regression-${id}\n`;

    await mkdir(path.dirname(outputPng), { recursive: true });
    await mkdir(path.dirname(artifactNote), { recursive: true });
    await writeFile(outputNote, "output-sentinel\n");
    await writeFile(outputPng, "png-sentinel");
    await writeFile(artifactNote, "artifact-sentinel\n");
    await writeFile(lockPath, lockContents, { flag: "wx" });

    const realBefore = await snapshotTree(realOutput, realArtifact);
    const guardBefore = await snapshotTree(guardOutput, guardArtifact);
    const missingDocker = await mkdtemp(path.join(os.tmpdir(), "qfs-no-docker-"));
    const infoFails = await writeFakeDocker(
      "#!/bin/sh\necho 'docker daemon unavailable' >&2\nexit 1\n",
    );
    const buildFails = await writeFakeDocker(
      "#!/bin/sh\nif [ \"$1\" = \"info\" ]; then\n  printf '%s\\n' linux\n  exit 0\nfi\necho 'simulated docker failure' >&2\nexit 1\n",
    );

    try {
      await expectDockerFailures(guardRoot, { missingDocker, infoFails, buildFails });

      assertSameTree(guardBefore, await snapshotTree(guardOutput, guardArtifact), "isolated workspace");
      assert.equal(await readFile(lockPath, "utf8"), lockContents);
      assert.equal(await readFile(outputNote, "utf8"), "output-sentinel\n");
      assert.equal(await readFile(outputPng, "utf8"), "png-sentinel");
      assert.equal(await readFile(artifactNote, "utf8"), "artifact-sentinel\n");
      assertSameTree(realBefore, await snapshotTree(realOutput, realArtifact), "real screenshot folders");
    } finally {
      await rm(guardRoot, { recursive: true, force: true });
      await rm(missingDocker, { recursive: true, force: true });
      await rm(infoFails, { recursive: true, force: true });
      await rm(buildFails, { recursive: true, force: true });
    }
  });
});
