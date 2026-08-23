# 2026-08-23 — структура infra согласована, план на реализацию

Продолжение `docs/diary/2026-08-22_clean-architecture-refactor.md` (вся история решений,
аудит утечек, обоснования `Repository` vs `Port` — там). Этот файл — точка перехода от
проектирования к реализации: финальная структура каталогов и конкретный план работы
для захода (агент в изолированном worktree).

## Финальная структура (согласована)

Порядок роль-ориентированный (`presentation`/`adapters`/`repository`/`db`/`workers` как
соседи внутри `infra/`), не по технологии — так ближе к `docs/diagram.d2`, чем
альтернатива с `infra/telegram/`-подпапкой, которую откинули по ходу обсуждения.

```
src/
├── domain/
│   ├── queue.ts             # QueueItem + QueueRepository (порт рядом с типом)
│   ├── resource.ts          # Track + ResourceRepository
│   ├── download.ts          # DownloadResult + DownloaderPort
│   ├── notifier.ts          # NotifierPort
│   └── track-cache.ts       # TrackCachePort
├── application/
│   ├── enqueue-download.ts
│   └── process-download-job.ts
├── infra/
│   ├── presentation/
│   │   ├── telegram-bot.ts              # createBot()
│   │   └── telegram-handlers.ts         # handle-message, /start, /status, listen-channel, handle-channel-history
│   ├── adapters/                         # port impl
│   │   ├── yt-dlp.ts                      # DownloaderPort
│   │   ├── telegram-notifier.ts           # NotifierPort
│   │   └── telegram-channel-cache.ts      # TrackCachePort
│   ├── repository/                       # repository impl
│   │   ├── queue-repository.ts            # QueueRepository (app.db)
│   │   ├── resource-repository.ts         # ResourceRepository (app.db)
│   │   ├── telegram-reply-refs.ts + .interfaces.ts   # TelegramReplyRef
│   │   └── telegram-track-refs.ts + .interfaces.ts   # TelegramTrackRef
│   ├── db/                                # db configs & setup
│   │   ├── app-db.ts                       # new Database(data/app.db) + миграции
│   │   └── telegram-db.ts                  # new Database(data/telegram.db) + миграции
│   └── workers/
│       └── queue-poller.ts                 # generic download-очередь
├── config.ts
├── logger.ts
└── main.ts                                 # composition root
```

Нюанс, зафиксированный отдельно: `repository/` и `db/` — плоские, без `telegram/`-подпапки,
telegram-специфичные файлы различаются только префиксом имени (`telegram-reply-refs.ts`
рядом с `queue-repository.ts`). Осознанно, не путаница.

## Объём этого захода

**Внутри:**
- Сам рефакторинг каталогов по структуре выше
- Все 5 находок аудита (`docs/diary/2026-08-22_...md`, секция «аудит архитектуры»)
- `geo_blocked` → `queue.block_reason` (opaque)
- Переход на 2 физические БД (`data/app.db` + `data/telegram.db`)
- Реализация хендлеров бота по `docs/specs/telegram-bot.md`

**Снаружи (отдельными заходами):**
- `cookies`-фича (`docs/backlog-cookies.md`) — не готова, зависит от `infrastructure`-репо
- `telegram_send_queue`/`send-queue-poller` — отдельное улучшение, не блокирует корректность
- Форвард исходного сообщения в канал (`docs/agents/planning.md`, «Бэклог: фичи»)

## План работы

1. **`domain/`** — пять файлов, типы + порты рядом (per-concept), по черновику
   `docs/specs/types.md`. `TrackCachePort.deliver(track, jobId)` — opaque `jobId`,
   не `chatId`/`messageId`.
2. **`infra/db/`** — `app-db.ts` (таблицы `queue`, `resource`/`tracks` — **без**
   `channel_message_id`, находка №1) и `telegram-db.ts` (`telegram_reply_refs`,
   новая `telegram_track_refs`). Каждый со своим набором миграций (`runMigrations`),
   не общий список как сейчас в `src/db/schema.ts`.
3. **Миграция данных** — `data/bot.db` уже содержит боевые данные (бот задеплоен и
   активно используется, см. `docs/diary/2026-08-19_raspberry-pi-hosting.md`).
   Нужен одноразовый скрипт: разложить текущие `queue`/`tracks`/`users`/`error_log`
   по `app.db`/`telegram.db`, перенести `tracks.channel_message_id` →
   `telegram_track_refs`, `geo_blocked`-статусы → `failed` + `block_reason='geo'`.
   **Не терять текущий кэш треков** — это боевые данные, не тестовые.
4. **`infra/repository/`** — `queue-repository.ts`, `resource-repository.ts` (app-db);
   `telegram-reply-refs.ts`, `telegram-track-refs.ts` + `.interfaces.ts` рядом с каждым.
5. **`infra/adapters/yt-dlp.ts`** — `DownloaderPort`. Переносит классификацию ошибок
   из `src/worker/index.ts` (находка №2: `isGeoBlocked`/`isNotFound`) + заодно
   `isDrmProtected` (найдено параллельно в `docs/backlog.md`, тот же паттерн) —
   возвращает typed `DownloadResult`, не кидает голый `Error`.
6. **`infra/adapters/telegram-notifier.ts`** (`NotifierPort`) и
   **`telegram-channel-cache.ts`** (`TrackCachePort`) — оба сами резолвят
   `chatId`/`messageId` через `telegram-reply-refs`, принимают только `jobId`.
7. **`application/`** — `enqueue-download.ts`, `process-download-job.ts`. Ретрай/бэкофф
   (30s→60s→120s, max 3) остаётся здесь — generic-логика, не telegram/yt-dlp-специфика.
8. **`infra/presentation/telegram-handlers.ts`** — по `docs/specs/telegram-bot.md`.
   `handle-message` зовёт `EnqueueDownload` вместо прямого SQL (находка №4).
   `listen-channel`/`handle-channel-history` — admin-only, вторая как заглушка.
9. **`infra/workers/queue-poller.ts`** — заменяет `src/worker/index.ts`. Зовёт
   `ProcessDownloadJob`, никаких прямых вызовов `bot.telegram.*` (находка №3).
10. **`main.ts`** — единственное место, где всё сшивается через DI.
11. **`users.username`** (находка №5) — решение отложено, оставить как есть в этом
    заходе (низкий приоритет, не блокирует); не забыть явно принять решение позже.

## Как проверять готовое

- `bun run typecheck` — обязателен после рефакторинга
- Ручной прогон: одиночный трек + плейлист с уже закэшированными и новыми треками
  (проверить, что `TrackCachePort`/миграция `channel_message_id` не сломали cache hit)
- `/status` в боте — читает по-прежнему корректно после переезда на `app.db`
