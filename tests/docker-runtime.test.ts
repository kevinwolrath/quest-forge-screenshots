import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("docker capture runtime", () => {
  it("pins the Playwright image to the locked package version", async () => {
    const pkg = JSON.parse(await readRepoFile("package.json")) as {
      devDependencies: { playwright: string };
      scripts: Record<string, string>;
    };
    const lock = JSON.parse(await readRepoFile("package-lock.json")) as {
      packages: Record<string, { version?: string }>;
    };
    const locked = lock.packages["node_modules/playwright"]?.version;
    assert.equal(pkg.devDependencies.playwright, "1.63.0");
    assert.equal(locked, "1.63.0");
    assert.equal(pkg.scripts["stage-artifact"], "tsx scripts/stage-artifact.ts");
    assert.equal(
      pkg.scripts["capture:docker-fixture"],
      "tsx scripts/verify-docker-capture.ts",
    );

    const dockerfile = await readRepoFile("Dockerfile");
    assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/playwright:v1\.63\.0-noble$/m);
    assert.match(dockerfile, /^RUN npm ci$/m);
    assert.match(dockerfile, /^ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1$/m);
    assert.match(dockerfile, /^ENTRYPOINT \["npm", "run"\]$/m);
    assert.match(dockerfile, /^CMD \["capture"\]$/m);
    assert.doesNotMatch(dockerfile, /^COPY .*\.env/m);
    assert.equal(dockerfile.includes("docker.sock"), false);
  });

  it("mounts only capture config and output, with host.docker.internal", async () => {
    const compose = await readRepoFile("compose.yaml");
    const volumeLines = compose
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ./"));
    assert.deepEqual(volumeLines, [
      "- ./config:/config:ro",
      "- ./screenshot-output:/output",
      "- ./screenshot-artifact:/artifact",
    ]);
    assert.match(compose, /^name: questforge-screenshot-capture$/m);
    assert.match(compose, /host\.docker\.internal:host-gateway/);
    assert.match(compose, /SCREENSHOT_BASE_URL: \$\{SCREENSHOT_BASE_URL:-\}/);
    assert.match(compose, /SCREENSHOT_CONFIG_DIR: \/config/);
    assert.match(compose, /SCREENSHOT_OUTPUT_DIR: \/output/);
    assert.match(compose, /SCREENSHOT_ARTIFACT_DIR: \/artifact/);
    assert.equal(compose.includes("docker.sock"), false);
    assert.equal(compose.includes("network_mode"), false);
    assert.equal(compose.includes("privileged"), false);
    assert.equal(compose.toLowerCase().includes("github_token"), false);
    assert.equal(compose.toLowerCase().includes("cloudflare"), false);
  });

  it("does not ship a workflow that can queue capture jobs", async () => {
    const workflowsDir = path.join(root, ".github/workflows");
    let entries: string[] = [];
    try {
      entries = await readdir(workflowsDir);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "ENOENT") throw error;
    }
    const workflows = entries.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
    assert.deepEqual(workflows, []);
    const retired = await readRepoFile("docs/retired-capture-workflow.md");
    assert.match(retired, /not scheduled/);
    assert.equal(retired.includes("workflow_dispatch:"), false);
    assert.equal(retired.includes("runs-on:"), false);
  });
});
