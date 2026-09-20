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
- **DB**: SQLite via `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`), files `data/app.db` and `data/telegram.db`
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
│   ├── download-job.ts   # stage 1: resolve → cache/archive hit? → download → archive → stage the file (status downloaded)
│   ├── deliver-job.ts    # stage 2: staged file → caches + user, own retry budget (never re-downloads)
│   ├── job-support.ts    # shared: failJob (permanent failure), errorMessage
│   ├── recover-stuck-jobs.ts     # startup: 'processing'/'delivering' left by a crashed run counts as an attempt
│   ├── requeue-blocked-jobs.ts   # requeue jobs by BlockReason, staggered
│   └── worker-log.ts
└── infrastructure/
    ├── presentation/     # telegram-bot, telegram-handlers, extract-url, health-server (/healthz)
    ├── adapters/         # yt-dlp (DownloaderPort), telegram-notifier (NotifierPort),
    │                     # telegram-channel-cache (ResourceCachePort), fs-cache-adapter (ResourceStorePort),
    │                     # telegram-client/send-media (shared upload helper, implements no port)
    ├── repository/       # sqlite: queue, resource, error-log; telegram: reply-refs, resource-refs, users
    ├── db/               # app-db.ts / telegram-db.ts (open + migrate), schema/{app,telegram}.ts (Drizzle schema), schema-utils.ts
    └── workers/          # queue-poller (WORKER_CONCURRENCY parallel loops)
```

Stores are wired in `main.ts` as two typed lists: `caches` (`ResourceCachePort`: store + deliver, the Telegram
channel; enabled by `CACHE_TO_CHANNEL`) and `archives` (`ResourceStorePort`: store only, fs; enabled by
`SAVE_TO_CONTENT_DIR`). When no cache delivers, the file is sent to the user directly via `NotifierPort`.

## Database

Two SQLite files in `DATA_DIR` (default `./data`), WAL mode:
- `app.db` — `queue`, `resource`, `error_log`
- `telegram.db` — `telegram_reply_refs`, `telegram_resource_refs`, `users`

Schema = Drizzle tables in `src/infrastructure/db/schema/`, migrations = SQL files in `drizzle/app/` and
`drizzle/telegram/` (shipped in the Docker image), applied on startup by `migrate()` in `openAppDb`/`openTelegramDb`
(journal table `__drizzle_migrations`). The `0000_baseline` migrations are `CREATE TABLE IF NOT EXISTS`, so they are a
no-op on databases that predate Drizzle.

The resource id column is `resource_id` everywhere (`queue`, `resource`, `telegram_resource_refs`). Databases
created before 2026-09 (`track_id`, `telegram_track_refs`) are converted on startup by the idempotent
`renameColumnIfExists`/`renameTableIfExists` in `src/infrastructure/db/schema-utils.ts`, called from
`openAppDb`/`openTelegramDb` before the Drizzle migrations. Not backward compatible: an older
image can't read a converted database — back up `DATA_DIR` before deploying.

**queue.status values** (`QueueStatus` enum in `domain/queue.ts`): `pending` → `processing` → `downloaded` → `delivering` → `done`
(or `failed`). A job has two stages with their own in-flight state and retry counter: *download* (`retries`, `retry_after`)
ends with the file staged on disk (`queue.file_path`, status `downloaded`); *delivery* (`deliver_retries`,
`deliver_retry_after`) sends it. A failing delivery is retried without downloading again. If the staged file is gone
(a restart clears the temp dir) the job goes back to `pending`, spending one download attempt.

**queue.block_reason** (`BlockReason` enum in `domain/block-reason.ts`) — why a job was permanently stopped:
`geo` (geo-restricted), `drm`, `too_large` (over the 50MB Bot API limit), `too_long` (audio whose duration alone can't fit the limit, refused before downloading), `crashed_repeatedly` (the
process died mid-download MAX_RETRIES times). Such jobs are `failed` with the reason set.
- With `PROXY` configured, on startup all jobs with `block_reason = 'geo'` are requeued to `pending`, staggered
  30s apart (`requeueBlockedJobs` in `main.ts`).
- `processing` jobs from a crashed run are recovered on startup by `recoverStuckJobs`: the crash counts as an
  attempt; after `MAX_RETRIES` the job becomes `failed` / `crashed_repeatedly` and the user is notified.
- `retry_after` — unix timestamp, job won't be claimed before this time (exponential backoff: 30s → 60s → 120s).

**Changing the schema**: edit the table in `src/infrastructure/db/schema/{app,telegram}.ts`, run `bun run db:generate`
(drizzle-kit writes the next SQL file into `drizzle/app` or `drizzle/telegram`), review it, commit schema + SQL + the
`meta/` snapshot together. Repositories (`infrastructure/repository/`) are the only place that queries the tables; SQL the
query builder can't express (`UPDATE … FROM` with a window function in `requeueByBlockReason`) stays raw via `sql`.

**error_log** — every failed attempt is written here (`ErrorLogRepository`) with job_id, url, error, timestamp.
The `queue.error` field only keeps the last error.

## Worker

- Two pools started by `startQueuePollers`: `WORKER_CONCURRENCY` download workers (default 3, claim `pending`) and
  `DELIVER_CONCURRENCY` delivery workers (default 1, claim `downloaded`)
- Each worker has its own colored logger (worker #1 = cyan, #2 = magenta, #3 = yellow, then repeating)
- Double `while(true)`: outer catches unexpected crashes and restarts after 5s, inner is the job loop
- Retry logic: max 3 attempts per stage, exponential backoff between retries
- Permanent failures (no retry): HTTP 404, geo restriction, DRM, over 50MB — the job goes to `failed`, the
  user is notified (`NotifierPort`)

## Bot texts

Every user-facing text lives in `src/infrastructure/localization/telegram.localization.json` (flat keys, e.g.
`message.queued`, `failure.geo`); code reads them through `t(key, params)` (`localization/t.ts`). Edit the JSON freely:
a text may use `{placeholders}` from the list in `TEXT_PARAMS` (`t.ts`) — fewer than listed is fine, unknown ones fail
`assertTextsValid()` on startup. Adding a text = a key in the JSON + an entry in `TEXT_PARAMS`; removing a key still used
in code fails `tsc`. `tests/localization.test.ts` checks the file.

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
| `WORKER_CONCURRENCY` | no | Number of parallel download workers (default 3) |
| `DELIVER_CONCURRENCY` | no | Number of parallel delivery workers (default 1) |
| `CONTENT_DIR` | no | Directory for permanent mp3/mp4 storage (default `./content`) |
| `CACHE_TO_CHANNEL` | no | Upload/cache tracks in the private channel (default `true`; `false` sends directly to the user, no dedup) |
| `SAVE_TO_CONTENT_DIR` | no | Save a permanent local copy to `CONTENT_DIR` (default `true`; `false` deletes the temp file after sending) |
| `TMP_DIR` | no | Temp dir for downloads (default `/tmp/ytdlp`) |
| `DATA_DIR` | no | Directory for `app.db` + `telegram.db` (default `./data`, read directly in `main.ts`) |
| `HEALTH_PORT` | no | Port of the `/healthz` liveness endpoint (default 3000) |
| `YT_DLP_PATH` | no | yt-dlp executable (default `yt-dlp` from PATH) |
| `MAX_TRACK_DURATION_SECONDS` | no | Audio longer than this is refused before downloading (default: derived from the 50MB limit, ≈28 min at mp3 quality 0) |
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
