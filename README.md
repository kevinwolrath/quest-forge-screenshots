# QuestForge screenshot gallery

A separate Cloudflare Worker project for a private, on-demand screenshot gallery. This repository is public, so treat every committed file as public.

## Status

This repository is an initial scaffold. It does not contain the QuestForge application, screenshots, Cloudflare credentials, or a working gallery/publish flow. Do not deploy it until the Access gate and gallery behavior have been implemented and reviewed.

## Intended workflow

1. A person manually starts the existing screenshot workflow on `.45`.
2. The workflow packages the complete capture as one ZIP and sends one authenticated publish request.
3. The service validates the ZIP before replacing the single current archive in a private R2 bucket.
4. The bookmarked Worker page is protected by Cloudflare Access, restricted to members of the Cloudflare account.
5. The browser retrieves the current ZIP through the Worker and displays the images together.

Each successful publish replaces the current archive. Do not retain dated run folders, upload individual images, trigger captures on every push, or publish to LinkedIn automatically.

## Repository boundaries

- Keep this service and its deployment independent from the QuestForge app repository.
- Do not copy QuestForge app source, local configuration, database contents, credentials, or generated screenshots into this repository.
- Keep only the minimum screenshot names and metadata needed by the gallery. Do not commit screenshot payloads or user/account details.

## Security and secrets

Assume all tracked content and Git history are public. Never commit Cloudflare account/admin tokens, R2 credentials, publisher credentials, `.env` files, `.dev.vars`, or real screenshots.

Cloudflare Access viewer sign-in and the screenshot publisher credential are separate controls. Use Cloudflare Access with the Cloudflare identity provider and account-member restriction; do not add email PIN or a separate email allowlist. Keep R2 private and serve content only through the authenticated Worker.

The future publisher credential belongs in GitHub Actions Secrets and should be passed only to the publish step/container at runtime. It must not be stored on `.45`, in Git, or in logs. Rotate it if it is ever exposed.

## Development

The Worker source and tests will live in this repository. Keep local runtime files out of Git with `.gitignore` and keep secrets and generated captures out of AI indexing with `.cursorignore`.

The first implementation should add focused tests for access control, ZIP validation, overwrite behavior, and failure recovery. Do not claim Cloudflare account setup or deployment has been verified unless it was actually performed.

## Deployment

Deploy from this repository using Cloudflare's Git integration after reviewing the Access policy and confirming R2 is private. Do not add an automatic screenshot-capture trigger to app pushes. Cloudflare account/admin credentials must not be added to GitHub Actions or the `.45` runner.
