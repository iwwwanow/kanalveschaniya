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

```
src/
├── main.ts               # entry point — initSchema → createBot → startWorker → bot.launch()
├── config.ts             # env vars (throws if BOT_TOKEN/CHANNEL_ID missing)
├── logger.ts             # chalk logger: logger.info/warn/error, logger.bot.*, logger.worker(id)
├── bot/
│   ├── index.ts          # Telegraf setup
│   └── handlers.ts       # /start, /status, onText(url)
├── db/
│   ├── index.ts          # bun:sqlite singleton, WAL mode
│   └── schema.ts         # CREATE TABLE + runMigrations()
└── worker/
    ├── index.ts          # 3 parallel workers (while-true loops), retry logic
    └── downloader.ts     # yt-dlp spawn: getInfo() + download()
```

## Database

Tables: `users`, `queue`, `tracks`, `error_log`, `migrations`

**queue.status values**: `pending` | `processing` | `done` | `failed` | `geo_blocked`

- `geo_blocked` — track is geo-restricted; saved for later retry when PROXY is set. On startup with PROXY configured, all `geo_blocked` jobs are automatically requeued to `pending`.
- `processing` jobs from a crashed run are reset to `pending` on every startup.
- `retry_after` — unix timestamp, job won't be claimed before this time (exponential backoff: 30s → 60s → 120s).

**Adding a new column**: add one entry to the `migrations` array in `src/db/schema.ts`. The migration system tracks applied migrations in the `migrations` table and skips already-applied ones.

```ts
{ name: "my_migration_name", sql: "ALTER TABLE queue ADD COLUMN foo TEXT" }
```

**error_log** — every failed attempt is written here with job_id, url, error, timestamp. The `queue.error` field only keeps the last error.

## Worker

- 3 parallel workers by default (`WORKER_CONCURRENCY` env, default 3)
- Each worker has its own colored logger: worker #1 = cyan, #2 = magenta, #3 = yellow
- Double `while(true)`: outer catches unexpected crashes and restarts after 5s, inner is the job loop
- Retry logic: max 3 attempts, exponential backoff between retries
- Fatal errors (no retry): HTTP 404, geo restriction
- Geo errors → `geo_blocked` status (not `failed`) so they can be retried later

## Downloader

- Audio → mp3 (yt-dlp `-x --audio-format mp3 --audio-quality 0`)
- Video → mp4 (`--merge-output-format mp4`)
- Format detection: `vcodec != null && vcodec != 'none'` → video, otherwise audio
- Playlists: `--flat-playlist -J` to get entries, then each track queued separately
- Flat-playlist entries have `url` field, not `webpage_url` — both handled in `parseMeta`
- Tracks > 50MB are skipped with user notification (Telegram Bot API limit)

## Env vars

| Var | Required | Description |
|-----|----------|-------------|
| `BOT_TOKEN` | yes | Telegram bot token |
| `CHANNEL_ID` | yes | Private channel ID (e.g. `-1001234567890`) |
| `PROXY` | no | socks5 proxy (e.g. `socks5://localhost:9090`) |
| `WORKER_CONCURRENCY` | no | Number of parallel workers (default 3) |
| `TMP_DIR` | no | Temp dir for downloads (default `/tmp/ytdlp`) |

## CI/CD

GitHub Actions in `.github/workflows/release.yml`:
1. **release** job — semantic-release on push to `master`/`beta`, bumps version, creates GitHub release, updates `package.json` + `CHANGELOG.md`
2. **docker** job — builds multi-platform image (amd64/arm64), pushes to `ghcr.io/iwwwanow/iwwwanow_kanalveshchaniya:VERSION` and `:latest`

Versioning via conventional commits. Config in `.releaserc.json`.

## Docs

- `docs/agents/planning.md` — architecture decisions and task priority
- `docs/agents/list.md` — todo list
- `docs/agents/testing.md` — test scenarios
