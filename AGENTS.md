# Repository instructions

This repository is the Cloudflare gallery and publisher for QuestForge screenshots. It is not the screenshot capture product.

QuestForge already captures screenshots in Docker on `.45` and uploads GitHub Actions artifacts. That existing workflow stays unchanged. This agent cannot read the private QuestForge repository and must not guess its file paths or claim to have changed them.

## Ownership

| Component | Owner |
| --- | --- |
| Existing screenshot workflow and the `.45` runner | QuestForge |
| Cloudflare Worker website, private R2, upload endpoint, publisher CLI | This repository |
| Future manual publish workflow | QuestForge, as a new workflow separate from capture |

A new QuestForge workflow will download an artifact from a selected successful screenshot run, check out a pinned commit of this repository, and invoke the publisher. The upload credential belongs in QuestForge Actions secrets and is injected only into that final publishing step. Never print it, commit it, or persist it on `.45`. Do not register another runner. Do not add cross-repository dispatch.

## Security requirements

- Treat this public repository and its Git history as visible to everyone.
- Never commit credentials, access tokens, private keys, real screenshots, or local environment files.
- Keep URLs containing credentials out of Git. Use `.env.example` placeholders only.
- Keep the R2 bucket private. Serve gallery HTML and the ZIP only through the Worker after Cloudflare Access authentication.
- Fail closed if viewer authentication cannot be established. Do not add email PIN or a separate viewer email allowlist.
- Keep viewer authentication separate from the publisher credential. The publish route does not accept an Access session in place of the upload secret, and the upload secret does not unlock gallery routes.
- Validate the complete ZIP before replacing the one current archive. A failed upload must leave the prior archive intact.
- Do not add a capture workflow in this repository. Do not add `workflow_dispatch` or any other trigger that can schedule `.45`. Do not invent a runner label.
- Do not start, stop, or alter QuestForge, its containers, or unrelated processes.
- Do not claim Cloudflare setup, deployment, live QuestForge capture, or a `.45` run was verified unless it was actually performed.
- Fixture checks are not QuestForge verification and are not `.45` runs. Mobile Playwright viewports are not native Android device tests.

## Working rules

- Make the smallest focused change that satisfies the issue.
- Read existing code and tests before editing. Preserve the established architecture; ask before adding a framework or broadening scope.
- Add focused tests for security-sensitive gallery and publish behavior; report exact commands and results.
- Keep generated artifacts out of Git. Use synthetic screenshot bytes only.
- The merged capture tool under `capture/`, `Dockerfile`, and `compose.yaml` is retained history. Do not describe it as the production capture path, and do not wire it back to GitHub Actions.
- Update the relevant Linear issue with implementation, PR links, actual checks, and remaining steps before handoff. Do not claim Done merely because a PR is open.

## Gallery contract

The publisher accepts one ZIP. The Worker stores that ZIP as the single object `current-screenshots.zip` only after validation. The browser downloads that one object and unpacks it. There is no per-image R2 URL.

Merge snapshots are the one other stored object type. `POST /publish/snapshots/<id>` (the same upload secret) stores `snapshots/<id>.zip` after validation, where `<id>` is `pr-<number>-<first 12 hex of the merge commit>`; a retry of the same merge replaces that object only. It never replaces `current-screenshots.zip` or another merge's snapshot. `GET /snapshots/<id>` returns it to a signed-in viewer only.

`manifest.json` may contain only `generatedAt` (UTC timestamp) and `images`. A snapshot's manifest also has `snapshot` (`id`, `kind: "merge"`, `pr` `{ number, title }`, `mergeCommit`, `mergedAt`, `screens`, `viewports`); the id must match the PR number and merge commit and the path, and the screens and viewports must match the images exactly. Each image has `file`, `screen`, and `viewport`. Image paths match `images/<name>.png`, `.jpg`, `.jpeg`, or `.webp`. Extra manifest fields, path traversal, unexpected names, and non-image bytes are rejected.
