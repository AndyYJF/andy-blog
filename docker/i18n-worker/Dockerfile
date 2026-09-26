# i18n translation worker — Node 24, no build step.
# Build context is the repo root so worker.js imports scripts/lib/i18n-*.js.
FROM node:24-bookworm-slim

WORKDIR /app
COPY docker/i18n-worker/package.json /app/docker/i18n-worker/package.json
RUN cd /app/docker/i18n-worker && npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY docker/i18n-worker/worker.js /app/docker/i18n-worker/worker.js
COPY scripts/lib/i18n-store.js /app/scripts/lib/i18n-store.js
COPY scripts/lib/i18n-kimi.js /app/scripts/lib/i18n-kimi.js
COPY data/i18n-glossary.json /app/data/i18n-glossary.json

USER node
CMD ["node", "docker/i18n-worker/worker.js"]
