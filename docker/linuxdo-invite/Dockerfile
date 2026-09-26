FROM node:22.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json lib.js server.js ./
USER node
EXPOSE 8370
CMD ["node", "server.js"]
