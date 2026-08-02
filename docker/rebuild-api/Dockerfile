# syntax=docker/dockerfile:1
# Rebuild API: verify HMAC, persist pending/dirty, never holds Docker socket.
FROM node:22.14.0-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=9000
ENV RUNTIME_DIR=/runtime/build

EXPOSE 9000
USER node
CMD ["node", "server.js"]
