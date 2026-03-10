# Stage 1: Build TypeScript → dist/
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Stage 2: Production
FROM node:22-alpine AS runner

# yt-dlp + ffmpeg + build tools for native modules (better-sqlite3, libxmljs)
RUN apk add --no-cache python3 py3-pip make g++ ffmpeg && \
    pip3 install --no-cache-dir yt-dlp --break-system-packages

RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

VOLUME ["/app/data"]

CMD ["node", "dist/server.js"]
