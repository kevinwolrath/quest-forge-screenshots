# Repository instructions

This repository contains the standalone QuestForge screenshot infrastructure: a Playwright capture tool and a Cloudflare Worker gallery scaffold. Do not copy QuestForge app source, database content, local configuration, or screenshot payloads into it.

## Security requirements

- Treat this public repository and its Git history as visible to everyone.
- Never commit credentials, access tokens, private keys, real screenshots, or local environment files.
- Keep URLs containing credentials out of Git. Use `.env.example` placeholders only.
- Capture against a configurable `SCREENSHOT_BASE_URL`. Do not hardcode machine IPs or hostnames in tracked files.
- Do not invent QuestForge routes, selectors, or theme controls. Start screens config with `/` only until real routes are known.
- Keep the R2 bucket private. Serve gallery data only through a Cloudflare Access-protected Worker.
- Fail closed if authentication cannot be established. Do not add email PIN or a separate viewer email allowlist.
- Keep viewer authentication separate from the publisher credential.
- The publisher credential belongs in GitHub Actions Secrets and may be passed only to the publish step/container at runtime. Never print it or persist it on .45.
- Validate the complete ZIP before replacing the one current archive. A failed upload must leave the prior archive intact.
- Keep capture manual/on demand. Do not add automatic screenshot capture on pushes, public pull-request runners on `.45`, or automatic LinkedIn publishing.
- Do not start, stop, or alter the QuestForge application, containers, or unrelated processes from capture jobs.
- Do not claim Cloudflare setup or deployment was verified unless it was actually performed.
- Automatic triggering after QuestForge merges requires access to that repository and is a later integration step; do not pretend it is implemented.

## Working rules

- Make the smallest focused change that satisfies the issue.
- Read existing code and tests before editing. Preserve the established architecture; ask before adding a framework or broadening scope.
- Add focused tests for security-sensitive and capture configuration behavior; report exact commands and results.
- Fixture verification is not QuestForge verification. Mobile Playwright viewports are not native Android device tests.
- Do not run live QuestForge capture, Android builds, or device tests unless explicitly requested.
- Keep generated artifacts out of Git.

## Runtime boundaries: Docker and .45

Production screenshot capture on .45 runs in the Linux container from `Dockerfile` and `compose.yaml`. The Windows runner orchestrates checkout, Docker, and artifact upload. It does not install Node, npm packages, or Chromium for that job. Do not describe a live QuestForge capture or a real .45 run as done unless it was actually performed.

| Component | Intended runtime |
| --- | --- |
| GitHub Actions runner | Windows host .45; orchestrates checkout, Docker and artifact upload |
| Label validation | GitHub-hosted validate-config job; no browser capture |
| Screenshot tool, Node dependencies, Playwright and Chromium | Dedicated Linux Docker container on .45 |
| QuestForge web application | Existing separately managed Docker service; capture connects through SCREENSHOT_BASE_URL |
| Gallery and restricted publish endpoint | Cloudflare Worker with private R2; not a .45 Docker service |
| Future ZIP publisher | Separate final step/container; publisher secret injected only there |

- Production capture does not install Node, npm packages, or Chromium on .45. Bare npm commands are optional local development and fixture instructions.
- The host requires the existing runner and working Docker Desktop with Linux containers. Do not recreate runner services or modify unrelated containers.
- The official Playwright image tag matches the locked Playwright package. `npm ci` installs dependencies inside the image. Chromium comes from that image.
- Container localhost is the container, not the Windows host. For an app port published on the host, set `SCREENSHOT_BASE_URL` to `http://host.docker.internal:PORT`. Do not hardcode a real host or IP, and do not invent app network names.
- Pass capture configuration at runtime. Mount only `config/` (read-only), `screenshot-output/`, and `screenshot-artifact/`. Do not mount the Docker socket, QuestForge source, or secrets unrelated to capture.
- Capture stays manual and connects to the already-running app. Do not start, stop or rebuild QuestForge.
- Report container fixture verification separately from live QuestForge and real .45 verification.
- Update the relevant Linear issue with implementation, PR links, actual checks and remaining steps before handoff. Do not claim Done merely because a PR is open.

