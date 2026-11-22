# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# wget/procps power the docker-compose healthchecks (wget --spider, pgrep).
# Debian (glibc) is required: @temporalio/core-bridge ships glibc-only binaries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget procps \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# tsconfig.json is used by the Temporal workflow bundler at worker startup.
COPY tsconfig.json ./
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/api/server.js"]
