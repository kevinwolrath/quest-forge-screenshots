# Repository instructions

This repository contains only the standalone Cloudflare screenshot-gallery service. Do not copy QuestForge app source, database content, local configuration, or screenshot payloads into it.

## Security requirements

- Treat this public repository and its Git history as visible to everyone.
- Never commit credentials, access tokens, private keys, real screenshots, or local environment files.
- Keep the R2 bucket private. Serve gallery data only through a Cloudflare Access-protected Worker.
- Fail closed if authentication cannot be established. Do not add email PIN or a separate viewer email allowlist.
- Keep viewer authentication separate from the publisher credential.
- The publisher credential belongs in GitHub Actions Secrets and may be passed only to the publish step/container at runtime. Never print it or persist it on .45.
- Validate the complete ZIP before replacing the one current archive. A failed upload must leave the prior archive intact.
- Do not add automatic screenshot capture on pushes or automatic LinkedIn publishing.
- Do not claim Cloudflare setup or deployment was verified unless it was actually performed.

## Working rules

- Make the smallest focused change that satisfies the issue.
- Read existing code and tests before editing. Preserve the established architecture; ask before adding a framework or broadening scope.
- Add focused tests for security-sensitive behavior and report exact commands and results.
- Do not run screenshot/Playwright capture, Android builds, or device tests unless explicitly requested.
- Keep generated artifacts out of Git.
