# syntax=docker/dockerfile:1
# Immutable production builder. Source and browser are baked into the image;
# runtime mounts contain only release/state data.
FROM node:22.14.0-bookworm

ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=$SOURCE_REVISION

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
  NPM_CONFIG_FETCH_RETRIES=5 \
  NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
  NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
  PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright \
  PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000
WORKDIR /app

COPY package.json package-lock.json ./
COPY astro/package.json astro/package-lock.json ./astro/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
RUN --mount=type=cache,target=/root/.npm npm --prefix astro ci --no-audit --no-fund
RUN cd astro && npx playwright install --with-deps chromium

COPY --chown=node:node . .
RUN mkdir -p /app/.cache /app/astro/.cache /runtime/build \
  && cp /app/docs/baselines/fixtures/img-dims.json /app/astro/.cache/img-dims.json \
  && chmod 0755 /app/host/*.sh /app/scripts/*.sh \
  && chown -R node:node /app /runtime/build /ms-playwright

USER node
