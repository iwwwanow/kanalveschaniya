FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime

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
COPY src/ ./src/
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV TZ=Europe/Moscow

VOLUME ["/app/data", "/app/content", "/tmp/ytdlp"]

CMD ["bun", "run", "src/main.ts"]
