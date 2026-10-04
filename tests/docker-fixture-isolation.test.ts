import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const productionOutput = path.join(root, "screenshot-output");
const productionArtifact = path.join(root, "screenshot-artifact");

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runVerifier(pathEnv: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/tsx/dist/cli.mjs"),
        path.join(root, "scripts/verify-docker-capture.ts"),
      ],
      {
        cwd: root,
        env: { ...process.env, PATH: pathEnv },
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

describe("docker fixture isolation", () => {
  it("leaves production screenshots and the capture lock in place when Docker fails", async () => {
    const id = randomBytes(4).toString("hex");
    const outputNote = path.join(productionOutput, `preexisting-output-${id}.txt`);
    const outputPng = path.join(productionOutput, "home", `preexisting-${id}.png`);
    const lockPath = path.join(productionOutput, ".capture.lock");
    const artifactNote = path.join(productionArtifact, `preexisting-artifact-${id}.txt`);
    const lockContents = `pid=regression-${id}\n`;
    let createdLock = false;
    let priorLock: string | null = null;

    await mkdir(path.dirname(outputPng), { recursive: true });
    await mkdir(productionArtifact, { recursive: true });
    await writeFile(outputNote, "output-sentinel\n");
    await writeFile(outputPng, "png-sentinel");
    await writeFile(artifactNote, "artifact-sentinel\n");
    try {
      priorLock = await readFile(lockPath, "utf8");
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "ENOENT") {
        throw error;
      }
      await writeFile(lockPath, lockContents, { flag: "wx" });
      createdLock = true;
    }

    const missingDocker = await mkdtemp(path.join(os.tmpdir(), "qfs-no-docker-"));
    const infoFails = await writeFakeDocker(
      "#!/bin/sh\necho 'docker daemon unavailable' >&2\nexit 1\n",
    );
    const buildFails = await writeFakeDocker(
      "#!/bin/sh\nif [ \"$1\" = \"info\" ]; then\n  printf '%s\\n' linux\n  exit 0\nfi\necho 'simulated docker failure' >&2\nexit 1\n",
    );

    try {
      const missing = await runVerifier(missingDocker);
      assert.equal(missing.code, 1, missing.stderr);
      assert.match(missing.stderr, /docker command not found/);

      const unavailable = await runVerifier(infoFails);
      assert.equal(unavailable.code, 1, unavailable.stderr);
      assert.match(unavailable.stderr, /Docker is unavailable/);

      const build = await runVerifier(`${buildFails}${path.delimiter}${missingDocker}`);
      assert.equal(build.code, 1, `${build.stdout}\n${build.stderr}`);
      assert.match(`${build.stdout}\n${build.stderr}`, /simulated docker failure|docker compose config failed/);

      assert.equal(await readFile(outputNote, "utf8"), "output-sentinel\n");
      assert.equal(await readFile(outputPng, "utf8"), "png-sentinel");
      assert.equal(await readFile(artifactNote, "utf8"), "artifact-sentinel\n");
      if (createdLock) {
        assert.equal(await readFile(lockPath, "utf8"), lockContents);
      } else {
        assert.equal(await readFile(lockPath, "utf8"), priorLock);
      }
      await access(productionOutput);
      await access(productionArtifact);
    } finally {
      await rm(outputNote, { force: true });
      await rm(outputPng, { force: true });
      await rm(artifactNote, { force: true });
      if (createdLock) {
        const current = await readFile(lockPath, "utf8").catch(() => null);
        if (current === lockContents) {
          await rm(lockPath, { force: true });
        }
      }
      for (const dir of [path.dirname(outputPng), productionOutput, productionArtifact]) {
        const entries = await readdir(dir).catch(() => null);
        if (entries && entries.length === 0) {
          await rm(dir, { recursive: false, force: true }).catch(() => undefined);
        }
      }
      await rm(missingDocker, { recursive: true, force: true });
      await rm(infoFails, { recursive: true, force: true });
      await rm(buildFails, { recursive: true, force: true });
    }
  });
});
