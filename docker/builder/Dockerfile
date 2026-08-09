# syntax=docker/dockerfile:1
# Immutable production builder. Source and browser are baked into the image;
# runtime mounts contain only release/state data.
FROM node:22.14.0-bookworm

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY package.json package-lock.json ./
COPY astro/package.json astro/package-lock.json ./astro/
RUN npm ci \
  && npm --prefix astro ci \
  && cd astro \
  && npx playwright install --with-deps chromium

COPY --chown=node:node . .
RUN mkdir -p /app/.cache /app/astro/.cache /runtime/build \
  && cp /app/docs/baselines/fixtures/img-dims.json /app/astro/.cache/img-dims.json \
  && chown -R node:node /app /runtime/build /ms-playwright

USER node
