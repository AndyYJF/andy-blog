# Builder: Node >=22.12 + Chromium for Mermaid. Not Alpine (Playwright needs glibc).
FROM node:22.14.0-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    util-linux curl openssl ca-certificates \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Browsers installed at image-build time once package.json is present in CI;
# for local scaffold, install during first compose build via a later layer.

USER node
