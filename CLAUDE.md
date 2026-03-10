# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram bot for scheduling and processing media downloads via the Cobalt service. Users send URLs to the bot, which queues them and processes downloads asynchronously.

## Commands

```bash
pnpm dev          # Start dev server with hot-reload (nodemon + tsx)
pnpm typecheck    # TypeScript type checking (tsc --noEmit)
pnpm db:generate  # Generate Drizzle ORM migrations
pnpm db:migrate   # Run database migrations
```

No test or lint scripts are configured yet.

## Architecture

Clean/Hexagonal Architecture with four layers:

```
Entrypoints → Application (Use Cases) → Adapters / Storage
```

- **`src/entrypoints/`** — Presentation layer. `telegram.entrypoint.ts` receives bot messages; `cron.entrypoint.ts` triggers processing every second.
- **`src/app/`** — Business logic. Two use cases: `schedule-download` (validates URL, adds to queue) and `process-download` (dequeues and downloads).
- **`src/adapters/`** — External service integrations. `cobalt.adapter.ts` calls the Cobalt media downloader API.
- **`src/storage/`** — SQLite persistence via Drizzle ORM. Two repositories: `queue.repository.ts` and `resource.repository.ts`.
- **`src/server.ts`** — Composition root; wires all dependencies together.

### Data Flow

1. User sends URL to Telegram bot
2. `ScheduleDownloadUseCase` creates a `resource` record (status: `pending`) and a `queue` entry
3. Cron fires every second → `ProcessDownloadUseCase` fetches pending queue items (limit: 1)
4. `CobaltAdapter` downloads the media (60s timeout)
5. Resource status updated to `downloaded` or `error`

### Database Schema

Two tables managed by Drizzle ORM with SQLite:
- **`resources`**: url (unique), status enum (`pending`|`processing`|`downloaded`|`error`)
- **`queue`**: references `resources.id`, tracks `scheduledAt` and `processedAt`

## Environment Variables

See `docs/env.md`. Required:
- `TELEGRAM_BOT_TOKEN`
- `DB_FILE_NAME` — path to SQLite file (stored in `data/`)
- `COBALT_URL` — URL of the Cobalt downloader service

## Docker

`docker-compose.yml` runs three services on `download-net`:
- **app** — Node.js 22-alpine running `pnpm dev`
- **cobalt** — Cobalt media downloader on port 9000
- **gost** — SOCKS5 proxy on port 8080 (routes cobalt traffic through host proxy)

## Key Constants

- Cron schedule: hardcoded `'* * * * * *'` (every second) in `src/entrypoints/cron.entrypoint.ts`
- Download limit per cron tick: `DOWNLOAD_LIMIT = 1` in `src/app/process-download.constants.ts`
