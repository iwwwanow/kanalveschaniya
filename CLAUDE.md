# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

Telegram bot that downloads music/video via yt-dlp and caches tracks in a private Telegram channel to avoid re-downloading.

**Two channels:**
- Bot — accepts links from users, queues downloads, forwards results
- Private channel — stores all downloaded files; bot forwards from there

## Stack

- **Runtime**: Bun (TypeScript, no compilation step)
- **Bot**: Telegraf
- **DB**: SQLite via `bun:sqlite` — file at `data/bot.db`
- **Downloader**: yt-dlp via `Bun.spawn` (no wrapper library)
- **Colors/logging**: chalk

## Running

```bash
bun run dev      # watch mode
bun run start    # production
bun run typecheck
```

**Required on host**: `yt-dlp`, `ffmpeg`

## Architecture

Clean architecture: dependencies point inward — `infrastructure -> application -> domain`. Diagrams:
`docs/diagrams/core.d2` (layers and ports), `core.infrastructure.ports.d2` (which infra implements which port)
and `core.infrastructure.telegram.d2` (where Telegram plugs in). One diagram = one question, ≤ ~12 nodes.
Types/ports spec — `docs/specs/types.md`.

```
src/
├── main.ts               # composition root — opens DBs, creates repos/adapters/use-cases, recovers stuck jobs, starts poller + health server, bot.launch()
├── config.ts             # env vars (throws if BOT_TOKEN/CHANNEL_ID missing)
├── logger.ts             # chalk logger: logger.info/warn/error, logger.bot.*, logger.worker(id)
├── domain/               # no dependencies: entities, ports, repository interfaces
│   ├── resource.ts       # Resource (a downloaded track/video), ResourceRepository
│   ├── queue.ts          # QueueItem, QueueStatus (enum), QueueRepository, MAX_RETRIES/backoffSeconds
│   ├── block-reason.ts   # BlockReason enum (geo | drm | too_large | crashed_repeatedly)
│   ├── download.ts       # DownloadResult, DownloaderPort
│   ├── notifier.ts       # NotifierPort
│   ├── resource-cache.ts # ResourceStorePort (find/save), DeliveryPort (deliver), ResourceCachePort = both
│   └── error-log.ts      # ErrorLogRepository
├── application/          # use-cases, know only domain
│   ├── enqueue-download.ts, get-user-queue-status.ts
│   ├── process-download-job.ts   # the job lifecycle: cache-hit → download → store/deliver, retries, failures
│   ├── recover-stuck-jobs.ts     # startup: 'processing' left by a crashed run counts as an attempt
│   ├── requeue-blocked-jobs.ts   # requeue jobs by BlockReason, staggered
│   └── worker-log.ts
└── infrastructure/
    ├── presentation/     # telegram-bot, telegram-handlers, extract-url, health-server (/healthz)
    ├── adapters/         # yt-dlp (DownloaderPort), telegram-notifier (NotifierPort),
    │                     # telegram-channel-cache (ResourceCachePort), fs-cache-adapter (ResourceStorePort),
    │                     # telegram-client/send-media (shared upload helper, implements no port)
    ├── repository/       # sqlite: queue, resource, error-log; telegram: reply-refs, resource-refs, users
    ├── db/               # app-db.ts (app.db), telegram-db.ts (telegram.db) — schema + migrations
    └── workers/          # queue-poller (WORKER_CONCURRENCY parallel loops)
```

Stores are wired in `main.ts` as two typed lists: `caches` (`ResourceCachePort`: store + deliver, the Telegram
channel; enabled by `CACHE_TO_CHANNEL`) and `archives` (`ResourceStorePort`: store only, fs; enabled by
`SAVE_TO_CONTENT_DIR`). When no cache delivers, the file is sent to the user directly via `NotifierPort`.

## Database

Two SQLite files in `DATA_DIR` (default `./data`), WAL mode:
- `app.db` — `queue`, `resource`, `error_log`, `migrations`
- `telegram.db` — `telegram_reply_refs`, `telegram_resource_refs`, `users`, `migrations`

The resource id column is `resource_id` everywhere (`queue`, `resource`, `telegram_resource_refs`). Databases
created before 2026-09 (`track_id`, `telegram_track_refs`) are converted on startup by the idempotent
`renameColumnIfExists`/`renameTableIfExists` in `src/infrastructure/db/schema-utils.ts`, called from
`openAppDb`/`openTelegramDb` before the `CREATE TABLE IF NOT EXISTS`. Not backward compatible: an older
image can't read a converted database — back up `DATA_DIR` before deploying.

**queue.status values**: `pending` | `processing` | `done` | `failed` (`QueueStatus` enum in `domain/queue.ts`)

**queue.block_reason** (`BlockReason` enum in `domain/block-reason.ts`) — why a job was permanently stopped:
`geo` (geo-restricted), `drm`, `too_large` (over the 50MB Bot API limit), `crashed_repeatedly` (the process
died mid-download MAX_RETRIES times). Such jobs are `failed` with the reason set.
- With `PROXY` configured, on startup all jobs with `block_reason = 'geo'` are requeued to `pending`, staggered
  30s apart (`requeueBlockedJobs` in `main.ts`).
- `processing` jobs from a crashed run are recovered on startup by `recoverStuckJobs`: the crash counts as an
  attempt; after `MAX_RETRIES` the job becomes `failed` / `crashed_repeatedly` and the user is notified.
- `retry_after` — unix timestamp, job won't be claimed before this time (exponential backoff: 30s → 60s → 120s).

**Adding a new column**: add one entry to the `migrations` array in `src/infrastructure/db/app-db.ts` (or
`telegram-db.ts`). Applied migrations are tracked in the `migrations` table and skipped.

```ts
{ name: "my_migration_name", sql: "ALTER TABLE queue ADD COLUMN foo TEXT" }
```

**error_log** — every failed attempt is written here (`ErrorLogRepository`) with job_id, url, error, timestamp.
The `queue.error` field only keeps the last error.

## Worker

- `WORKER_CONCURRENCY` parallel workers (default 3), started by `startQueuePoller`
- Each worker has its own colored logger: worker #1 = cyan, #2 = magenta, #3 = yellow
- Double `while(true)`: outer catches unexpected crashes and restarts after 5s, inner is the job loop
- Retry logic: max 3 attempts, exponential backoff between retries
- Permanent failures (no retry): HTTP 404, geo restriction, DRM, over 50MB — the job goes to `failed`, the
  user is notified (`NotifierPort`)

## Downloader

- Audio → mp3 (yt-dlp `-x --audio-format mp3 --audio-quality 0`)
- Video → mp4 (`--merge-output-format mp4`)
- Format detection: `vcodec != null && vcodec != 'none'` → video, otherwise audio
- Playlists: `--flat-playlist -J` to get entries, then each track queued separately
- Flat-playlist entries have `url` field, not `webpage_url` — both handled in `parseMeta`
- Files > 50MB are rejected (Telegram Bot API limit): job `failed` with `block_reason = too_large`, user notified

## Env vars

| Var | Required | Description |
|-----|----------|-------------|
| `BOT_TOKEN` | yes | Telegram bot token |
| `CHANNEL_ID` | yes | Private channel ID (e.g. `-1001234567890`) |
| `PROXY` | no | socks5 proxy (e.g. `socks5://localhost:9090`) |
| `WORKER_CONCURRENCY` | no | Number of parallel workers (default 3) |
| `CONTENT_DIR` | no | Directory for permanent mp3/mp4 storage (default `./content`) |
| `CACHE_TO_CHANNEL` | no | Upload/cache tracks in the private channel (default `true`; `false` sends directly to the user, no dedup) |
| `SAVE_TO_CONTENT_DIR` | no | Save a permanent local copy to `CONTENT_DIR` (default `true`; `false` deletes the temp file after sending) |
| `TMP_DIR` | no | Temp dir for downloads (default `/tmp/ytdlp`) |
| `DATA_DIR` | no | Directory for `app.db` + `telegram.db` (default `./data`, read directly in `main.ts`) |
| `HEALTH_PORT` | no | Port of the `/healthz` liveness endpoint (default 3000) |
| `ALLOW_PLAYLIST_DOWNLOADS` | no | Playlists are rejected unless `true` (default `false`; set after the 1800-track incident) |

## CI/CD

GitHub Actions in `.github/workflows/release.yml`:
1. **release** job — semantic-release on push to `master`/`beta`, bumps version, creates GitHub release, updates `package.json` + `CHANGELOG.md`
2. **docker** job — builds multi-platform image (amd64/arm64), pushes to `ghcr.io/iwwwanow/kanalveschaniya:VERSION` and `:latest`

Versioning via conventional commits. Config in `.releaserc.json`.

## Docs

- `docs/agents/planning.md` — architecture decisions and task priority
- `docs/agents/list.md` — todo list
- `docs/agents/testing.md` — test scenarios
- `docs/specs/types.md` — types/ports spec; `docs/diagrams/*.d2` — architecture diagrams
- `docs/backlog/`, `docs/diary/` — standalone notes and session logs
