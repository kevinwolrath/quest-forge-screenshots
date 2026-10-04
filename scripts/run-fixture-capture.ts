import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCaptureOptions } from "../capture/config.ts";
import { runCapture } from "../capture/run.ts";
import { startFixtureServer } from "./fixture-server.ts";

/**
 * Fixture verification only. This does not capture or verify the live
 * QuestForge application.
 */
async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const server = await startFixtureServer();

  try {
    const options = resolveCaptureOptions(
      {
        ...process.env,
        SCREENSHOT_BASE_URL: server.baseUrl,
        SCREENSHOT_OUTPUT_DIR:
          process.env.SCREENSHOT_OUTPUT_DIR?.trim() ||
          path.join(root, "screenshot-output", "fixture"),
        SCREENSHOT_CONFIG_DIR:
          process.env.SCREENSHOT_CONFIG_DIR?.trim() || path.join(root, "config"),
        SCREENSHOT_APP_COMMIT_SHA:
          process.env.SCREENSHOT_APP_COMMIT_SHA?.trim() || "fixture-unverified",
      },
      root,
    );

    console.log("FIXTURE VERIFICATION (not QuestForge)");
    console.log(`baseUrl=${options.baseUrl}`);
    console.log(`outputDir=${options.outputDir}`);

    const manifest = await runCapture(options);
    if (manifest.summary.failed > 0) {
      console.error(
        `Fixture capture finished with ${manifest.summary.failed} failure(s).`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `Fixture capture ok: ${manifest.summary.ok}/${manifest.summary.total}.`,
    );
  } finally {
    await server.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
