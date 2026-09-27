FROM oven/bun:1.3 AS deps
WORKDIR /app
# bun workspaces resolve against each member's package.json — needs them present before install,
# not just the root one.
COPY package.json bun.lock* bun.lockb* ./
COPY apps/core/package.json ./apps/core/
COPY apps/session/package.json ./apps/session/
COPY packages/shared-queue/package.json ./packages/shared-queue/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    curl \
    python3 \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/core/src/ ./apps/core/src/
# SQL migrations (drizzle-kit output), applied on startup by openAppDb/openTelegramDb
COPY apps/core/drizzle/ ./apps/core/drizzle/
# node_modules/shared-queue is a symlink to here (bun workspace) — not bundled, so the actual
# source has to be present at runtime too, not just node_modules.
COPY packages/shared-queue/package.json ./packages/shared-queue/
COPY packages/shared-queue/src/ ./packages/shared-queue/src/
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV TZ=Europe/Moscow

VOLUME ["/app/data", "/app/content", "/tmp/ytdlp"]

CMD ["bun", "run", "apps/core/src/main.ts"]
