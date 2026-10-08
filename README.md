# QuestForge screenshot gallery

This repository is the private Cloudflare gallery and the publisher that uploads one screenshot ZIP. It does not capture QuestForge.

QuestForge already captures screenshots in Docker on `.45` and uploads a GitHub Actions artifact. That existing workflow stays as it is. This repository cannot see the private QuestForge source, so it does not name QuestForge workflow files or claim to change them.

| Piece | Where it lives |
| --- | --- |
| Screenshot capture and the `.45` runner | QuestForge |
| Worker site, private R2 bucket, `/publish` endpoint, publisher CLI | This repository |
| Manual publish workflow (not built yet) | A new workflow in QuestForge |

There is no second runner and no cross-repository dispatch. The upload credential is a QuestForge Actions secret. It is injected only into the final publishing step. Do not print it, commit it, or write it onto `.45`.

## Gallery

Viewers sign in with Cloudflare Access using the Cloudflare identity provider, limited to members of the Cloudflare account. There is no email one-time PIN and no viewer email allowlist.

The Worker fails closed. `GET /` and `GET /archive` return 403 before any gallery HTML or ZIP bytes when the Access token is missing, the Access team domain or audience is unset, or the token does not verify. The publisher secret does not unlock those routes.

A signed-in browser loads `/`, downloads `/archive` once, and unpacks the ZIP locally into one flat responsive grid. Captions show the screen and viewport labels from the manifest, plus the `generatedAt` timestamp. Images can be opened larger. The page does not request one R2 object per image.

R2 stays private. The only stored object is `current-screenshots.zip`. Public bucket access and `r2.dev` URLs are not part of this design.

## Publish

`POST /publish` accepts one ZIP. It checks the upload secret with a dedicated credential, separate from Access. Requests without that secret are rejected, including requests that carry a viewer token.

The ZIP is validated before the stored object is replaced:

- One `manifest.json` whose only fields are `generatedAt` and `images`
- `generatedAt` is a UTC timestamp such as `2026-10-04T12:00:00.000Z`
- Each image has `file`, `screen`, and `viewport`
- Files are `images/<name>.png`, `.jpg`, `.jpeg`, or `.webp`, and the bytes match that type
- No extra archive entries, absolute paths, or `..` segments
- Zip size, entry count, and expanded size stay under the limits in `src/limits.ts` (the zip limit is below the Workers Free 100 MiB request-body cap)

A rejected upload leaves the previous ZIP in place. A failed write does too. The gallery keeps one current set, not a history of runs.

## Merge snapshots

QuestForge also publishes a snapshot of the screens a merged pull request declared. It goes to its own object and never replaces `current-screenshots.zip`:

- `POST /publish/snapshots/<id>` with the same upload secret. `<id>` is `pr-<number>-<first 12 hex of the merge commit>`, so a retry of the same merge replaces its own `snapshots/<id>.zip` instead of adding another.
- The ZIP follows the archive rules above. Its `manifest.json` also has a `snapshot` block:

  ```json
  {
    "generatedAt": "2026-10-08T09:10:00.000Z",
    "snapshot": {
      "id": "pr-278-696eb12abcde",
      "kind": "merge",
      "pr": { "number": 278, "title": "Show character portraits" },
      "mergeCommit": "<40 hex>",
      "mergedAt": "2026-10-08T09:00:00Z",
      "screens": ["c03-characters"],
      "viewports": ["desktop", "tablet", "mobile"]
    },
    "images": [{ "file": "images/c03-characters-desktop.png", "screen": "c03-characters", "viewport": "desktop 1440x900" }]
  }
  ```

  The id must match the PR number, the merge commit and the path. `screens` and `viewports` are stable ids; every image belongs to one of each (its `viewport` label starts with the viewport id), and each listed id has an image. The PR title is plain text of at most 200 characters with no line breaks or control characters.
- A rejected or failed write leaves any earlier snapshot and the current archive as they were.
- `GET /snapshots/<id>` returns that ZIP to a signed-in viewer, behind the same Access check as `/archive`. Listing and showing snapshots in the gallery page is separate work.

```bash
npm run publish:snapshot -- ./snapshot.zip
```

It validates the snapshot, then posts it to `/publish/snapshots/<id>` on the `GALLERY_PUBLISH_URL` origin, and prints the stored key.

Local publisher command, from a checkout of this repository:

```bash
export GALLERY_PUBLISH_URL="https://HOST/publish"
export GALLERY_PUBLISH_SECRET="(injected secret)"
npm run publish:archive -- ./gallery.zip
```

The URL must be `http` or `https`, path `/publish`, with no username or password. The command prints the archive name on success. It does not print the secret.

## QuestForge publish workflow

Add this as a **new** manual workflow in the QuestForge repository. Do not edit the existing screenshot workflow.

1. Trigger it manually with the id of one successful screenshot run in QuestForge.
2. Download that run's artifact.
3. Check out a pinned commit of `kevinwolrath/quest-forge-screenshots`.
4. If the artifact is not already the gallery ZIP described above, package it into that ZIP in the QuestForge workflow. This repository does not know the artifact's internal layout, so it does not name those paths.
5. Run `npm run publish:archive -- <gallery.zip>` from the pinned checkout.
6. Put `GALLERY_PUBLISH_URL` and `GALLERY_PUBLISH_SECRET` in the environment of that last step only. Store the secret in QuestForge Actions secrets. Do not print it or persist it on `.45`.

Use a runner QuestForge already has, or a GitHub-hosted runner. Do not register a new runner. A hosted runner can download the artifact and publish without placing the secret on `.45`.

The workflow should fail when capture selection, packaging, or the upload fails. The previous gallery ZIP stays available when the upload is rejected.

## Cloudflare setup still required

These dashboard steps are not done by this repository and were not verified here:

1. Create a private R2 bucket named `quest-forge-screenshots`. Leave public access and `r2.dev` off.
2. Deploy the Worker in `src/` with the `SCREENSHOTS` R2 binding. `npx wrangler deploy` is the deploy command when you choose to deploy. Do not store a Cloudflare account token on `.45`.
3. Put Cloudflare Access in front of the Worker hostname. Use the Cloudflare identity provider and an account-member policy. Do not enable email one-time PIN.
4. Set Worker variables `ACCESS_TEAM_DOMAIN` (the Access team host, such as `your-team.cloudflareaccess.com`) and `ACCESS_AUD` (the Access application audience tag). Set secret `PUBLISH_SECRET` to the same value as the QuestForge Actions secret.
5. Until those Access variables verify a real token, viewer routes stay 403.

Free-plan notes: the Worker uses the `workers.dev` hostname (`workers_dev` in `wrangler.jsonc`). The publish body limit in code is 20 MiB, under the Workers Free request-body limit. Do not enable paid image resizing, public R2, or a custom domain unless you intend to leave the free allowance.

## Local checks

```bash
npm install
npm run typecheck
npm test
```

`npm test` uses synthetic image bytes. It does not capture QuestForge and it does not prove Cloudflare Access, R2, or `.45`.

`npm run dev` (`wrangler dev`) and `npm run deploy` talk to Cloudflare when credentials exist. They were not run for the gallery work in this tree.

## Retained capture code

`capture/`, `Dockerfile`, `compose.yaml`, and the fixture scripts remain from merged pull requests [1](https://github.com/kevinwolrath/quest-forge-screenshots/pull/1) and [2](https://github.com/kevinwolrath/quest-forge-screenshots/pull/2). They are not scheduled. See [docs/retired-capture-workflow.md](docs/retired-capture-workflow.md).

Optional fixture commands on a machine that already has Node or Docker:

```bash
npm run capture:fixture
npm run capture:docker-fixture
```

Passing those checks does not mean QuestForge was captured and does not mean `.45` ran them. Do not point this repository's Actions configuration at `.45`.

## Security

- Never commit `.env`, secrets, tokens, personal data, or generated screenshots.
- Viewer Access and the publisher secret stay separate.
- Gallery metadata is the manifest timestamp and the screen/viewport labels. Local paths, account email, and secrets are not accepted in the manifest and are not shown.
