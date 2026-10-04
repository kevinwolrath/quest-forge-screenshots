import { resolveCaptureOptions } from "./config.ts";
import { loadEnvFile } from "./load-env.ts";
import { runCapture } from "./run.ts";

async function main(): Promise<void> {
  await loadEnvFile();
  const options = resolveCaptureOptions();
  console.log(`baseUrl=${options.baseUrl}`);
  console.log(`outputDir=${options.outputDir}`);
  if (options.appCommitSha) {
    console.log(
      `appCommitSha=${options.appCommitSha} (metadata only; not verified)`,
    );
  }

  const manifest = await runCapture(options);
  if (manifest.summary.failed > 0) {
    console.error(
      `Capture finished with ${manifest.summary.failed} failure(s) out of ${manifest.summary.total}.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Capture finished successfully: ${manifest.summary.ok}/${manifest.summary.total}.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
