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
