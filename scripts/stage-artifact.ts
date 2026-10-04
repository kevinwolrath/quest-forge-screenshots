import path from "node:path";

import { stageCurrentRunArtifact } from "../capture/output.ts";

async function main(): Promise<void> {
  const outputDir = path.resolve(
    process.env.SCREENSHOT_OUTPUT_DIR?.trim() || "screenshot-output",
  );
  const artifactDir = path.resolve(
    process.env.SCREENSHOT_ARTIFACT_DIR?.trim() || "screenshot-artifact",
  );
  const staged = await stageCurrentRunArtifact(outputDir, artifactDir);
  console.log(`staged ${staged.length} artifact path(s) into ${artifactDir}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
