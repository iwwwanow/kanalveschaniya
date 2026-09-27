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

Bun workspace (`apps/*` deployable apps, `packages/*` shared code — see Architecture below). All
scripts run from the repo root:

```bash
bun run dev:core          # watch mode (core is the only runnable app for now)
bun run start:core        # production
bun run typecheck         # aggregate: runs each workspace member's own typecheck script
bun run db:generate       # aggregate: db:generate:core + db:generate:session
```

**Required on host**: `yt-dlp`, `ffmpeg`

## Architecture

Bun workspace, two kinds of member: `apps/*` (deployable) and `packages/*` (shared code, no
deployment of its own). Right now `apps/core` is the only thing that actually runs — `apps/session`
(session-service, see below) is a module `apps/core/src/main.ts` imports and starts in the same
process, not a separate deploy yet (see `docs/specs/session-app.specs.md` for why and when that
changes). Cross-workspace imports are plain package names (`shared-queue`, `session`, ...), resolved
via bun's workspace symlinks in `node_modules` — see each package's own `package.json`.

**`apps/core`** — clean architecture: dependencies point inward — `infrastructure -> application ->
domain`. Diagrams: `docs/diagrams/core.d2` (layers and ports), `core.infrastructure.ports.d2` (which
infra implements which port) and `core.infrastructure.telegram.d2` (where Telegram plugs in). One
diagram = one question, ≤ ~12 nodes. Types/ports live in `apps/core/src/domain/` and
`apps/core/src/application/` — read those directly, they're the source of truth.

```
apps/core/src/
├── main.ts               # composition root for the WHOLE PROCESS — opens all DBs (app/telegram/session), wires
│                         # core's + session-service's repos/use-cases, recovers stuck jobs, installs process
│                         # guards, starts core's pollers + session-service's poller + health server + bot
├── config.ts             # env vars (throws if BOT_TOKEN/CHANNEL_ID missing; SESSION_ENCRYPTION_KEY optional)
├── logger.ts             # adds core's `.bot` tag on top of shared-logger's tagged/worker logger
├── domain/               # no dependencies: entities, ports, repository interfaces
│   ├── resource.ts       # Resource (a downloaded track/video), ResourceRepository
│   ├── queue.ts          # QueueItem, QueueRepository (re-exports QueueStatus/MAX_RETRIES/backoffSeconds from shared-queue)
│   ├── download.ts       # DownloadResult, DownloaderPort (download() takes an optional cookieFilePath)
│   ├── notifier.ts       # NotifierPort
│   ├── resource-cache.ts # ResourceStorePort (find/save), DeliveryPort (deliver), ResourceCachePort = both
│   ├── error-log.ts      # ErrorLogRepository
│   └── session-context.ts # SessionContextPort — the one thing core depends on from session-service
├── application/          # use-cases, know only domain
│   ├── enqueue-download.ts, get-user-queue-status.ts
│   ├── download-job.ts   # stage 1: resolve-stage needs_cookie preflight (SessionContextPort) → cache/archive hit? → download → archive → stage
│   ├── deliver-job.ts    # stage 2: staged file → caches + user, own retry budget (never re-downloads)
│   ├── job-support.ts    # shared: failJob (permanent failure), errorMessage
│   ├── recover-stuck-jobs.ts     # startup: 'processing'/'delivering' left by a crashed run counts as an attempt
│   ├── requeue-blocked-jobs.ts   # requeue jobs by BlockReason, staggered
│   └── worker-log.ts
└── infrastructure/
    ├── presentation/     # telegram-bot (createBot + startBot), telegram-handlers, extract-url, health-server (/healthz)
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

**`apps/session`** (session-service) — cookie/account service for platforms that need an
authenticated session (e.g. SoundCloud). Same domain/application/infrastructure layout as core, its
own `session.db` (migrated by itself, never by core). Detailed design, entities, db-schema and the
open questions (proxy binding, account-rotation strategy, browser-emulator vendor, cookie-freshness
classification) — `docs/specs/session-app.specs.md`. The only coupling with core is two narrow,
consumer-owned ports (dependency inversion — each side defines the port it needs, the other side's
object just happens to satisfy it structurally): `SessionContextPort` (core's `domain/`, session
implements it — "does this url need a cookie, is one usable") and `QueueSignalPort` (session's
`domain/`, core's own `QueueRepository` satisfies it — "which services are needs_cookie-blocked,
requeue this one"). `apps/core/src/main.ts` wires both, since it's the composition root for the
whole process right now.

**`packages/`** — code genuinely shared between `apps/core` and `apps/session` (both run in one
process, so sharing the actual module instance matters, not just the type shape):
- `shared-queue` — the `queue` table itself (Drizzle `queueTable`, migrated by core, read/written by
  session-service through `QueueSignalPort`), `BlockReason`, `QueueStatus`, `MAX_RETRIES`/`backoffSeconds`
- `shared-secrets` — `redact`/`registerSecret`/`describeError`; one process-wide `secrets` Set, so a
  secret either app registers (core's `BOT_TOKEN`, session's decrypted cookie) is masked everywhere
- `shared-logger` — the tagged/worker logger both apps' log lines go through (core adds its own
  `.bot` tag on top)

## Database

Three SQLite files in `DATA_DIR` (default `./data`), WAL mode:
- `app.db` (core) — `queue`, `resource`, `error_log`
- `telegram.db` (core) — `telegram_reply_refs`, `telegram_resource_refs`, `users`
- `session.db` (session-service) — `services`, `accounts`, `proxies`, `cookies`, `account_jobs` — see
  `docs/specs/session-app.specs.md`. Its own migrations, core never touches this file.

Schema = Drizzle tables in `apps/core/src/infrastructure/db/schema/` (`app.ts` re-exports `queueTable`
from `shared-queue`, the single source of truth also read by session-service) and
`apps/session/src/infrastructure/db/schema/session.ts`. Migrations = SQL files in `apps/core/drizzle/{app,telegram}/`
and `apps/session/drizzle/session/` (shipped in the Docker image), applied on startup by `migrate()` in
`openAppDb`/`openTelegramDb`/`openSessionDb` (journal table `__drizzle_migrations` per db). The `0000_baseline`
migrations for `app.db`/`telegram.db` are `CREATE TABLE IF NOT EXISTS`, so they are a no-op on databases that
predate Drizzle.

The resource id column is `resource_id` everywhere (`queue`, `resource`, `telegram_resource_refs`). Databases
created before 2026-09 (`track_id`, `telegram_track_refs`) are converted on startup by the idempotent
`renameColumnIfExists`/`renameTableIfExists` in `apps/core/src/infrastructure/db/schema-utils.ts`, called from
`openAppDb`/`openTelegramDb` before the Drizzle migrations. Not backward compatible: an older
image can't read a converted database — back up `DATA_DIR` before deploying.

**queue.status values** (`QueueStatus` enum, `shared-queue` package, re-exported from core's `domain/queue.ts`):
`pending` → `processing` → `downloaded` → `delivering` → `done` (or `failed`). A job has two stages with their own
in-flight state and retry counter: *download* (`retries`, `retry_after`) ends with the file staged on disk
(`queue.file_path`, status `downloaded`); *delivery* (`deliver_retries`, `deliver_retry_after`) sends it. A failing
delivery is retried without downloading again. If the staged file is gone (a restart clears the temp dir) the job
goes back to `pending`, spending one download attempt.

**queue.block_reason** (`BlockReason` enum, `shared-queue` package) — why a job was permanently stopped:
`geo` (geo-restricted), `drm`, `too_large` (over the 50MB Bot API limit), `too_long` (audio whose duration alone
can't fit the limit, refused before downloading), `crashed_repeatedly` (the process died mid-download MAX_RETRIES
times), `needs_cookie` (session-service: the resource's service requires a cookie and none is usable right now —
not bounded by MAX_RETRIES, sits until session-service requeues it, see `docs/specs/session-app.specs.md`). Such
jobs are `failed` with the reason set.
- With `PROXY` configured, on startup all jobs with `block_reason = 'geo'` are requeued to `pending`, staggered
  30s apart (`requeueBlockedJobs` in `main.ts`).
- `needs_cookie` jobs are requeued per-service (`queue.service_id`, set by the resolve-stage preflight) once
  session-service's account_job flow gets that service a working account — see `createRequeueBlockedByService`
  in `apps/session`.
- `processing` jobs from a crashed run are recovered on startup by `recoverStuckJobs`: the crash counts as an
  attempt; after `MAX_RETRIES` the job becomes `failed` / `crashed_repeatedly` and the user is notified.
- `retry_after` — unix timestamp, job won't be claimed before this time (exponential backoff: 30s → 60s → 120s).

**Changing the schema**: edit the table in `apps/core/src/infrastructure/db/schema/{app,telegram}.ts` (or
`apps/session/src/infrastructure/db/schema/session.ts`), run `bun run db:generate` (or the `:core`/`:session`
variant for just one), review the generated SQL, commit schema + SQL + the `meta/` snapshot together. Repositories
(`infrastructure/repository/`) are the only place that queries the tables; SQL the query builder can't express
(`UPDATE … FROM` with a window function in `requeueByBlockReason`) stays raw via `sql`.

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

## Logging and secrets

Every Bot API url contains the token, and Bun's fetch errors keep the full url in their `path` field, so a
raw error print leaks it (it happened on 2026-09-23 — see `docs/diary/2026-09-26_token-in-logs-and-polling-crash.md`).
Therefore:

- `logger.*` pushes every argument through `redact()` (`shared-secrets` package) — the token pattern plus the
  exact token registered by `registerSecret(config.botToken)` in `main.ts`. One process-wide `secrets` Set, so
  session-service's decrypted-cookie `registerSecret()` call is masked in core's log lines too. `errorMessage()`
  (`application/job-support.ts`) redacts too, since it is persisted in `error_log` / `queue.error`.
- `main.ts` installs `unhandledRejection` / `uncaughtException` handlers so nothing is printed by Bun's own
  (unredacted) handler. A rejection is logged and survived; an uncaught exception is logged and exits 1.
- Never `console.log` an error object directly — use the logger.
- `startBot` (`presentation/telegram-bot.ts`) restarts long polling in-process: telegraf only retries
  getUpdates errors named `FetchError`, and Bun's native fetch (which also shims `node-fetch`) throws plain
  `Error` with `code: "ECONNRESET"`, which used to kill the process. `bot.catch` keeps a failing handler from
  tearing polling down.

## Bot texts

Every user-facing text lives in `apps/core/src/infrastructure/localization/telegram.localization.json` (flat keys,
e.g. `message.queued`, `failure.geo`); code reads them through `t(key, params)` (`localization/t.ts`). Edit the
JSON freely: a text may use `{placeholders}` from the list in `TEXT_PARAMS` (`t.ts`) — fewer than listed is fine,
unknown ones fail `assertTextsValid()` on startup. Adding a text = a key in the JSON + an entry in `TEXT_PARAMS`;
removing a key still used in code fails `tsc`. `apps/core/tests/localization.test.ts` checks the file.

## Downloader

- Audio → mp3 (yt-dlp `-x --audio-format mp3 --audio-quality 0`)
- Video → mp4 (`--merge-output-format mp4`)
- Format detection: `vcodec != null && vcodec != 'none'` → video, otherwise audio
- Playlists: `--flat-playlist -J` to get entries, then each track queued separately
- Flat-playlist entries have `url` field, not `webpage_url` — both handled in `parseMeta`
- Files > 50MB are rejected (Telegram Bot API limit): job `failed` with `block_reason = too_large`, user notified
- Cookie-gated resources: `download()` takes an optional `cookieFilePath`, passed to yt-dlp as `--cookies <path>`
  when session-service's resolve-stage preflight supplied one (see Architecture — `SessionContextPort`)

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
| `DATA_DIR` | no | Directory for `app.db` + `telegram.db` + `session.db` (default `./data`, read directly in `main.ts`) |
| `HEALTH_PORT` | no | Port of the `/healthz` liveness endpoint (default 3000) |
| `YT_DLP_PATH` | no | yt-dlp executable (default `yt-dlp` from PATH) |
| `MAX_TRACK_DURATION_SECONDS` | no | Audio longer than this is refused before downloading (default: derived from the 50MB limit, ≈28 min at mp3 quality 0) |
| `ALLOW_PLAYLIST_DOWNLOADS` | no | Playlists are rejected unless `true` (default `false`; set after the 1800-track incident) |
| `SESSION_ENCRYPTION_KEY` | no | session-service: key for cookie blobs at rest in `session.db`. Only needed once a cookie-gated service has an account provisioned (see `docs/specs/session-app.specs.md`); unset logs a warning, doesn't fail boot |

## CI/CD

GitHub Actions in `.github/workflows/release.yml`:
1. **release** job — semantic-release on push to `master`/`beta`, bumps version, creates GitHub release, updates `package.json` + `CHANGELOG.md`
2. **docker** job — builds multi-platform image (amd64/arm64), pushes to `ghcr.io/iwwwanow/kanalveschaniya:VERSION` and `:latest`

Versioning via conventional commits. Config in `.releaserc.json`.

## Docs

- `docs/agents/planning.md` — architecture decisions and task priority
- `docs/agents/list.md` — todo list
- `docs/agents/testing.md` — test scenarios
- `docs/specs/` — specs for individual features/services (e.g. `session-app.specs.md`); `docs/diagrams/*.d2` — architecture diagrams
- `docs/backlog/`, `docs/diary/` — standalone notes and session logs
