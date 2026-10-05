/**
 * Retained parser from the retired capture workflow.
 * Nothing in this repository schedules a runner with it.
 * No dependencies; safe for `node scripts/validate-runner-labels.mjs`.
 */

import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string | undefined | null} raw
 * @returns {string[]}
 */
export function parseRunnerLabels(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(
      "SCREENSHOT_RUNNER_LABELS is missing. Set repository variable SCREENSHOT_RUNNER_LABELS to a JSON array of .45 runner labels.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "SCREENSHOT_RUNNER_LABELS must be valid JSON (an array of label strings).",
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "SCREENSHOT_RUNNER_LABELS must be a non-empty JSON array of label strings.",
    );
  }

  const labels = parsed.map((label, index) => {
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error(
        `SCREENSHOT_RUNNER_LABELS[${index}] must be a non-empty string.`,
      );
    }
    return label.trim();
  });

  if (!labels.includes("self-hosted")) {
    throw new Error(
      'SCREENSHOT_RUNNER_LABELS must include the "self-hosted" label.',
    );
  }

  return labels;
}

function run() {
  const labels = parseRunnerLabels(process.env.SCREENSHOT_RUNNER_LABELS);
  const encoded = JSON.stringify(labels);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `runner_labels=${encoded}\n`, "utf8");
  }
  console.log(`runner labels ok (${labels.length})`);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
