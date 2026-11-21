# JARVIS AI Hub — Multi-stage Node.js 22 Alpine Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/storage && chown -R node:node /app
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts ./server.ts
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/src/services ./src/services

USER node
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/brain/health || exit 1

CMD ["npx", "tsx", "server.ts"]
