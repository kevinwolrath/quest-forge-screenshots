# QuestForge screenshots

Public repository for two related pieces of screenshot infrastructure:

1. **Playwright capture tool** (this README focus) — manually capture the already-running QuestForge web app through a configurable URL.
2. **Cloudflare Worker gallery scaffold** — private gallery service (fail-closed placeholder in `src/`). Not required for local or `.45` capture.

This repository does **not** contain the QuestForge application, private assets, real screenshots, or Cloudflare credentials. Treat every committed file as public.

## Capture overview

The capture tool opens Chromium via Playwright, visits routes from `config/screens.json` at desktop / tablet / mobile viewports from `config/viewports.json`, waits for fonts and images, disables animations where practical, and writes PNGs plus `manifest.json` under `screenshot-output/` (gitignored).

Theme switching is intentionally unconfigured until QuestForge’s real theme controls are known. Captures use the application’s current appearance.

Mobile captures use Playwright Chromium viewport emulation. They are **not** native Android device tests.

Automatic triggering after QuestForge merges is a **later integration** that needs access to the QuestForge repository. It is **not** implemented here and is not a blocker for manual capture.

## Installation

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Edit `.env` and replace the `HOST:PORT` placeholders in `SCREENSHOT_BASE_URL` with the credential-free origin of the running app (scheme + host[+port], no path, no username/password). `npm run capture` loads `.env` when present; variables already set in the shell win. Do not commit `.env`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `SCREENSHOT_BASE_URL` | Yes | Application origin only. No hardcoded host lives in tracked files. |
| `SCREENSHOT_APP_COMMIT_SHA` | No | Optional metadata recorded in the manifest. **Not verified.** |
| `SCREENSHOT_CONFIG_DIR` | No | Defaults to `config`. |
| `SCREENSHOT_OUTPUT_DIR` | No | Defaults to `screenshot-output`. |
| `SCREENSHOT_NAVIGATION_TIMEOUT_MS` | No | Defaults to `30000`. |
| `SCREENSHOT_READY_TIMEOUT_MS` | No | Defaults to `15000`. |

### Screens (`config/screens.json`)

Start with `/` only. Add more screens by appending objects; capture code does not need changes.

```json
{
  "screens": [
    {
      "id": "home",
      "path": "/",
      "readySelector": null
    }
  ]
}
```

Optional per-screen `readySelector` waits for a visible CSS selector before the screenshot.

Do not invent QuestForge routes or selectors here until they are known from the live app.

### Viewports (`config/viewports.json`)

| id | width × height | notes |
| --- | ---: | --- |
| `desktop` | 1440 × 900 | mouse, no touch |
| `tablet` | 768 × 1024 | mobile + touch |
| `mobile` | 390 × 844 | mobile + touch |

All presets use `deviceScaleFactor: 1`. Edit the JSON to change dimensions without changing capture code.

## Local capture (real app)

With QuestForge already running and reachable:

```bash
export SCREENSHOT_BASE_URL="http://HOST:PORT"   # your running app origin
# optional:
# export SCREENSHOT_APP_COMMIT_SHA="<sha>"
npm run capture
```

Or export the variables in your shell (shell values override `.env`). Output:

- `screenshot-output/<screen>/<viewport>-<w>x<h>.png`
- `screenshot-output/manifest.json` (URL, timestamp, viewports, routes, results, optional SHA)

Concurrent captures that target the same output directory are blocked by `.capture.lock`.

## Fixture verification (not QuestForge)

When the real application URL is unavailable, verify the tool against the local HTML fixture:

```bash
npm test
npm run capture:fixture
```

Passing fixture checks means the capture pipeline works. It does **not** mean QuestForge was captured or verified.

## GitHub Actions on `.45`

Workflow: [`.github/workflows/screenshots-45.yml`](.github/workflows/screenshots-45.yml)

- Trigger: **manual** `workflow_dispatch` only
- No `pull_request` / `push` triggers (public PR code must not run on `.45`)
- Does not start, stop, or alter QuestForge, containers, or unrelated processes
- Concurrency group `screenshots-45` prevents overlapping capture jobs
- Stages and uploads only the current run’s screenshots plus `manifest.json` as an Actions artifact with **30-day** retention (or shorter if the repository artifact retention setting is lower). Unrelated files left in the output directory are not uploaded.

### Runner labels (you must set these)

Set repository variable **`SCREENSHOT_RUNNER_LABELS`**:

1. Open this repo on GitHub → **Settings** → **Secrets and variables** → **Actions** → **Variables**
2. Create `SCREENSHOT_RUNNER_LABELS` as a nonempty JSON array of nonempty strings for your `.45` screenshot runner
3. The array **must include** `"self-hosted"` (plus your real lane labels)

Example shape (replace non-`self-hosted` labels with your actual ones):

```json
["self-hosted","Windows","X64","questforge-screenshots"]
```

A GitHub-hosted `validate-config` job checks this variable first. If it is missing, not valid JSON, empty, contains blank strings, or omits `self-hosted`, that job fails promptly and the `.45` capture job is never scheduled. There is no fake fallback runner label. Capture itself still runs only on `.45` after validation succeeds. The workflow remains `workflow_dispatch` only (no `pull_request` execution on `.45`).

### Secrets / inputs

| Name | Where | Purpose |
| --- | --- | --- |
| `SCREENSHOT_BASE_URL` | Actions secret | Credential-free origin of the already-running QuestForge app |
| `SCREENSHOT_APP_COMMIT_SHA` | Optional secret or variable | Default metadata SHA for the manifest |
| `base_url_override` | Workflow input | One-off origin override for a single run |
| `app_commit_sha` | Workflow input | One-off metadata SHA for a single run |

### Manual workflow execution

1. Ensure QuestForge is already running where `.45` can reach it.
2. Confirm `SCREENSHOT_RUNNER_LABELS` and `SCREENSHOT_BASE_URL` are set.
3. Actions → **Screenshots on 45** → **Run workflow**.
4. Optionally supply `app_commit_sha` and/or `base_url_override`.

### Artifact downloads

1. Open the completed workflow run.
2. Download artifact `questforge-screenshots-<run_id>.<attempt>`.
3. Extract to inspect PNGs and `manifest.json`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `SCREENSHOT_BASE_URL is required` | Export the variable or copy `.env.example` → `.env` and load it. |
| `must not include credentials` | Use a credential-free origin. |
| Navigation / timeout failures | Confirm the app is up from the capture host; raise `SCREENSHOT_NAVIGATION_TIMEOUT_MS` / `SCREENSHOT_READY_TIMEOUT_MS` if needed. |
| Ready selector timeout | Fix or clear `readySelector` for that screen; do not invent selectors. |
| Lock errors | Another capture holds `screenshot-output/.capture.lock`. Wait, or remove only if no capture is running. |
| Workflow: runner labels not configured / invalid | Set `SCREENSHOT_RUNNER_LABELS` to a nonempty JSON string array that includes `self-hosted`. The hosted `validate-config` job fails before `.45` is queued. |
| Workflow cannot reach the app | `.45` must resolve `SCREENSHOT_BASE_URL` on your LAN; this tool will not start the app. |
| Fixture passes but real capture fails | Expected distinction: fixture ≠ QuestForge verification. |

## Gallery Worker scaffold

`src/`, `wrangler.jsonc`, and related docs describe the future Access-protected gallery. Capture does not depend on deploying the Worker. Do not claim Cloudflare setup or deployment was verified unless it was actually performed.

## Security

- Never commit `.env`, secrets, tokens, personal data, or generated screenshots.
- Keep URLs with credentials out of Git and logs.
- Publisher / Cloudflare credentials (for a future gallery publish step) stay separate from capture and must not be stored on `.45`.
- Keep generated output out of Git via `.gitignore` / `.cursorignore`.
