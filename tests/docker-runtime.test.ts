import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  it("runs capture through Docker and keeps hosted label validation", async () => {
    const workflow = await readRepoFile(".github/workflows/screenshots-45.yml");
    assert.match(workflow, /^on:\n {2}workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^\s{2}(push|pull_request|schedule|workflow_run):/m);
    assert.match(workflow, /runs-on: ubuntu-latest/);
    assert.match(workflow, /node scripts\/validate-runner-labels\.mjs/);
    assert.match(workflow, /fromJSON\(needs\.validate-config\.outputs\.runner_labels\)/);
    assert.match(workflow, /docker compose build capture/);
    assert.match(workflow, /docker compose run --rm -T --no-deps capture$/m);
    assert.match(workflow, /docker compose run --rm -T --no-deps capture stage-artifact/);
    assert.match(workflow, /actions\/upload-artifact@v4/);
    assert.match(workflow, /path: screenshot-artifact\//);
    assert.match(workflow, /retention-days: 30/);
    assert.match(workflow, /if-no-files-found: warn/);
    assert.match(workflow, /group: screenshots-45/);
    assert.equal(workflow.includes("actions/setup-node"), false);
    assert.equal(workflow.includes("playwright install"), false);
    assert.equal(workflow.includes("npm ci"), false);
    assert.equal(workflow.includes("docker.sock"), false);
    assert.equal((workflow.match(/if: always\(\)/g) || []).length, 2);
  });
});
