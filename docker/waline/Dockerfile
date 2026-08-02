# Waline + comment-policy middleware wrapper.
# Pin WALINE_UPSTREAM_IMAGE to tag@sha256 in production .env (Stage 9).
ARG WALINE_UPSTREAM_IMAGE=lizheming/waline:3.15.2
FROM ${WALINE_UPSTREAM_IMAGE} AS upstream

FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY policy.js server.js entrypoint.sh ./
RUN chmod +x entrypoint.sh
# Re-export upstream waline CLI if present; entrypoint starts both processes.
COPY --from=upstream /app /waline
ENV PORT=8360
ENV WALINE_UPSTREAM=127.0.0.1:8361
EXPOSE 8360
ENTRYPOINT ["/app/entrypoint.sh"]
