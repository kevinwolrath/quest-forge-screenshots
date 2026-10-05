# Retained capture image from the merged standalone experiment.
# This repository does not schedule it. QuestForge owns screenshot capture.
# Official Playwright image. The tag matches the locked playwright version
# in package-lock.json (enforced by tests/docker-runtime.test.ts).
# Node 24 in this image satisfies package.json engines (>=22).
# Chromium is already installed under /ms-playwright.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

# Keep the image browsers. npm ci must not download a second browser build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY capture ./capture
COPY config ./config
COPY fixture ./fixture
COPY scripts ./scripts

ENV SCREENSHOT_CONFIG_DIR=/config
ENV SCREENSHOT_OUTPUT_DIR=/output
ENV SCREENSHOT_ARTIFACT_DIR=/artifact

RUN mkdir -p /config /output /artifact \
  && cp -a /app/config/. /config/

# `docker compose run <service> <script>` replaces CMD and becomes `npm run <script>`.
ENTRYPOINT ["npm", "run"]
CMD ["capture"]
