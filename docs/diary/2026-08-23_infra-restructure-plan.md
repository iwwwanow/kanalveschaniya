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

## Реализация — сессия 2026-08-23, вечер

План уточнён (`/home/operator/.claude/plans/telegram-kanalveschaniya-noble-canyon.md`) —
7 решений, которых не было в доках выше: `users`→`telegram.db`, `error_log`→`app.db`
(пишет `ProcessDownloadJob` напрямую, без репозитория), admin-auth для
`listen-channel`/`handle-channel-history` — через `getChatMember(channelId, userId)`
(`"administrator"`/`"creator"`), а не отдельный env var; `src/worker/telegram-upload.ts`
переносится **дословно** (обход двух багов — Bun `fetch`+HTTP CONNECT proxy, и
telegraf error-хендлер) как `infra/adapters/telegram-send-media.ts`; `CACHE_TO_CHANNEL=false`
обрабатывается в `NotifierPort` (шлёт файл напрямую на успехе, когда кэш выключен);
бэкофф-баг (120с ретрай никогда не срабатывал, off-by-one) — исправлен; DRM fast-fail
(`isDrmProtected`, паттерн `"DRM protected"`) добавлен заодно с geo/404. Полный список —
в файле плана.

**Ключевая проблема, которую решили в плане**: `data/bot.db` в этом чекауте не
существует — реальная БД только на Pi (см. `docs/diary/2026-08-19_raspberry-pi-hosting.md`).
Миграция `bot.db → app.db+telegram.db` поэтому сделана НЕ отдельным скриптом, а
автоматической идемпотентной функцией (`infra/db/migrate-legacy.ts`), которая едет в
образе и сама срабатывает на первом старте с legacy-БД, никогда не удаляя `bot.db`.

**Реализация делегирована агенту** (`subagent_type: general-purpose`, `isolation: "worktree"`) —
результат в отдельном git worktree, НЕ в основной копии:

- Путь: `.claude/worktrees/agent-aab999315a92a7e92/`
- Ветка: `worktree-agent-aab999315a92a7e92` (от `refactor/architecture`, коммит `b136be0`)
- Не закоммичено — по правилу `CLAUDE.md` ("никогда не коммить за юзера"), юзер коммитит сам

Структура реализована полностью: `domain/` (5 файлов) → `application/` (2 use-case) →
`infra/{db,repository,adapters,presentation,workers}` → `main.ts` (composition root).
`bun run typecheck` чистый. Я прочитал весь диф файл за файлом (домен, обе схемы БД,
`migrate-legacy.ts`, `process-download-job.ts`, `yt-dlp.ts` классификация ошибок,
`telegram-notifier.ts`/`telegram-channel-cache.ts`, хендлеры, `main.ts`) — логика
соответствует плану, миграция корректно гардит идемпотентность (`appDbAlreadyExisted`
считается ДО `openAppDb()`, т.к. `bun:sqlite` создаёт файл при `{create:true}`).

Отклонения агента от черновика `types.md` (обоснованные, не редизайн — см. подробности
в отчёте агента): `QueueItem`/`QueueRepository` получили доп. поля для dedup/backoff/`/status`
(`retries`, `retryAfter`, `findPendingByUrl`, `findPendingByTrackId`, `countByStatusForUser`) —
черновик их не покрывал, хотя находка №4 явно требовала убрать эти SQL-запросы из
presentation; `NotifierPort` получил `notifyPlaylistQueued()` — плейлисты не описаны в
`telegram-bot.md` вообще; `ProcessDownloadJobDeps.registerPlaylistEntryOrigin` — колбэк,
которым fan-out плейлиста регистрирует `telegram_reply_refs` для дочерних джоб, не
пропуская telegram-типы в `application`.

**Ручная проверка — начата, не завершена.** В `.env.local` был только `BOT_TOKEN` от
**боевого** бота (без `CHANNEL_ID`) — юзер дал вместо него токен отдельного тестового
бота `@iwwwanow_dev_bot` + `CHANNEL_ID=-1004480832310`, чтобы не конфликтовать
long-polling'ом с живым ботом на Pi. Также на этой машине не было `yt-dlp` (только
`ffmpeg`) — юзер поставил сам (`sudo pacman -S yt-dlp`, не через меня — правило
"никакого sudo от Claude"). Бот стартовал чисто (`bun run dev` в worktree, лог: 3
воркера + бот запущены, миграция `bot.db` корректно no-op'нулась — файла нет).
Юзер тестировать будет **завтра** — процесс остановлен (`SIGTERM`).

## Остаток работы

Вместо ручного прогона 2026-08-24 вечером прошла архитектурная ревизия (юзер попросил
"давай тестировать и проверять архитектуру") — см. секции «Ревизия — 2026-08-24» и
«Правки по итогам ревью юзера» ниже. Сам ручной прогон в боте **так и не проводился**,
и уже устарел относительно кода — с прошлого раза (`process-download-job.ts`,
`domain/track-cache.ts`, новый `fs-cache-adapter.ts`, `main.ts`) поменялось многое.

- [ ] Ручной прогон (актуален заново, старый чеклист ниже относится к коду ДО сегодняшних
      правок): `/start`, `/status`, одиночный трек, повторная отправка того же URL
      (дедуп → cache hit через telegram-стор), плейлист. `.env.local` в ворктри уже
      настроен на тестовый бот `@iwwwanow_dev_bot` + `CHANNEL_ID=-1004480832310`
      (не боевой — конфликта long-polling с Pi не будет)
- [ ] Отдельно проверить `SAVE_TO_CONTENT_DIR`-путь руками — `fs-cache-adapter.ts` совсем
      новый, ни разу не запускался: имя файла должно быть `{title}_{trackId}.{ext}`,
      повторный найденный локально файл (`find()` по суффиксу через `readdir`) — не
      триггерит доставку (см. известное ограничение ниже), это ожидаемо, не баг
- [ ] Смёрджить `worktree-agent-aab999315a92a7e92` (ветка того же имени) в
      `refactor/architecture` — юзер решит сам, после успешного ручного прогона
- [ ] Не поднимать тестовый бот-процесс повторно с боевым `BOT_TOKEN` параллельно с
      Pi-инстансом — конфликт long-polling
- [ ] После мёржа — `docs/agents/planning.md`/`CLAUDE.md` всё ещё описывают
      дорефакторную структуру (`src/bot/`, `src/db/`, `src/worker/`) — обновить
- [ ] Открытый архитектурный хвост (не блокирует, см. `docs/backlog.md`) — fs-only
      cache-hit не переиспользуется, трек скачается заново, если `CACHE_TO_CHANNEL=false`

## Ревизия — 2026-08-24: `TrackCachePort` → `TrackStorePort` + `TrackCachePort`

Повод — обсуждали, что сохранение в `CONTENT_DIR` (`config.saveToContentDir`) сейчас
живёт инлайновым `fs`-кодом прямо в `application/process-download-job.ts`
(`saveToContent()`, вызов `fs/promises` напрямую), хотя по духу это тот же кейс, что и
`TrackCachePort` — «сохранить трек в ещё одном месте». Возникла идея: сделать
`fs-cache-adapter`, который тоже реализует `TrackCachePort`, и в `application` вызывать
`find`/`save` перебором массива реализаций вместо `if (config.saveToContentDir) {...}`.

**Найдена путаница по ходу обсуждения** — `deliver(track, jobId)` в эту идею не
укладывается: он физически завязан на `telegram_track_refs`/`channelId`
(`forwardMessage`), которых у fs-адаптера нет и не может быть — «доставка» локального
файла пользователю всё равно идёт через Telegram, не через сам fs. Обобщать `deliver` на
произвольный store в массиве — фиктивная абстракция.

Заодно всплыло смежное наблюдение: `NotifierPort.notify()` и `TrackCachePort.deliver()`
оба резолвят `jobId → chatId` через `telegram_reply_refs` и оба шлют что-то пользователю
через Telegram Bot API (`notify` — свежескачанные байты через `sendMedia`, когда
`CACHE_TO_CHANNEL=false`; `deliver` — форвард уже существующего сообщения из канала через
`forwardMessage`, на cache-hit). Не полный дубль, но пересечение ответственности
("резолви адрес по jobId и пошли что-то в Telegram") налицо. **Решение — не трогать
сейчас**, оставить как есть; см. открытый вопрос ниже.

**Принятое решение** (реализовано в `.claude/worktrees/agent-aab999315a92a7e92`,
`src/domain/track-cache.ts`, `bun run typecheck` чистый, `docs/specs/types.md` и
`docs/diagram.d2` синхронизированы):

- `TrackStorePort { find, save }` — generic, может быть несколько реализаций
  одновременно (`stores: TrackStorePort[]`, фанаут по массиву).
- `TrackCachePort extends TrackStorePort { deliver }` — остаётся telegram-специфичным,
  используется как единственный экземпляр, не через массив. `deliver` НЕ становится
  отдельным доменным портом — он привязан именно к этой (telegram) реализации.
- `telegram-channel-cache.ts` не менялся вообще — как реализовывал все три метода, так и
  реализовывает; один и тот же объект теперь просто удовлетворяет обоим интерфейсам
  (structural typing), `main.ts`/`process-download-job.ts` тоже не тронуты.

**Осознанно остановились здесь на паузу** — после третьей итерации редизайна одного и
того же куска стало путаться в голове, нормальный сигнал сделать паузу, а не признак
того, что архитектура плохая.

**Затем юзер попросил довести до конца в этой же сессии** ("почему сразу fs-adapter не
реализуем? вроде интерфейс готов") — и сформулировал итоговый паттерн: application
принимает `stores: TrackStorePort[]`, перебирает и сохраняет по всем; если у стора есть
`deliver` — вызывает и его. Реализовано полностью (ворктри `agent-aab999315a92a7e92`,
`bun run typecheck` чистый):

- `domain/track-cache.ts` — добавлена `isTrackCachePort(store): store is TrackCachePort`
  (duck-typing по наличию `deliver`) — способ, которым application узнаёт, какие сторы
  из массива умеют раздавать файл, не заводя отдельного поля/массива под них.
- `infra/adapters/fs-cache-adapter.ts` (новый) — `TrackStorePort`. `save()` — `copyFile`
  (не `rename`!) в `content/{mp3,mp4}/{trackId}.{ext}`, плюс `resource.save(track)`
  (переиспользует общую metadata-таблицу). `find()` — проверяет физическое наличие файла
  на диске, и только если есть — читает метаданные из `resource`.
- **Находка по ходу, поймана до того как стала багом**: `telegram-channel-cache.find()`
  до этого читал только общую `resource`-таблицу (`deps.resource.findByTrackId`), не
  проверяя ничего telegram-специфичного. Пока `resource` писал только telegram-стор, это
  было безопасно. Как только fs-стор тоже начал писать в `resource` при своём `save()`,
  `find()` стал бы врать "есть в канале" для треков, закэшированных только на диске — и
  `deliver()` падал бы (`No channel ref for track`). Пофикшено: `find()` теперь сперва
  проверяет `trackRefs.get(trackId)` (backend-proof, telegram-специфичный) и только потом
  читает общую `resource`-таблицу.
- `application/process-download-job.ts` — `saveToContent()`/`config.saveToContentDir`
  инлайн полностью вырезан. `findAndDeliver()` (замена прежнего
  `trackCache.find()+deliver()`) перебирает `deps.stores`, пропускает не-`TrackCachePort`,
  раздаёт первый найденный. Post-download блок — цикл `for (store of stores) { save();
  if (isTrackCachePort(store)) deliver() }`, `delivered`-флаг → фолбэк на
  `notifier.notify()`, если ни один стор не смог раздать сам. Временный файл теперь
  **всегда** удаляется одним `unlink()` после цикла (не только когда
  `saveToContentDir=false`, как раньше) — это следствие того, что все `save()`
  реализации теперь единообразно копируют, а не забирают владение исходником.
- `main.ts` — `stores` собирается по конфигу (`cacheToChannel` → push telegram-стор,
  `saveToContentDir` → push fs-стор), передаётся в `ProcessDownloadJobDeps.stores`. Поле
  `cacheEnabled` убрано — больше не нужно, включённость стора теперь выражена самим его
  присутствием в массиве.

**Важное поведенческое изменение, надо знать при ревью** — раньше файлы в `CONTENT_DIR`
сохранялись под оригинальным именем от yt-dlp (обычно название трека/видео, например
`Erik Satie - Gymnopédie No.1.mp3`). Теперь — `{trackId}.mp3`/`{trackId}.mp4` (непрозрачный
ID источника). Причина — `find()` фс-стора должен проверять наличие файла по `trackId` без
отдельного индекса path-по-track_id; человекочитаемое имя такой проверки не даёт. Не
затрагивает уже сохранённые на Pi файлы (только новые сохранения), но меняет то, как
выглядит личная библиотека при просмотре папки руками — юзер решит сам, устраивает или
нет (альтернатива — заводить отдельный индекс trackId→path и оставить человекочитаемые
имена, не сделано, т.к. это опять новая абстракция ради ещё не нужного удобства).

**Осталось нерешённым и записано в бэклог** (`docs/backlog.md`, "fs-only cache-hit не
переиспользуется"): cache-hit-проверка смотрит только на сторы с `deliver` — fs-only хит
(когда `CACHE_TO_CHANNEL=false`) не переиспользуется, трек скачается заново. Не блокирует
(этот сценарий — не дефолтный), но открытый хвост на будущее: нужен способ отправить
пользователю уже лежащий на диске файл через `NotifierPort`, не через `deliver`.

## Правки по итогам ревью юзера — тем же вечером 2026-08-24

Юзер попросил доработать ещё три момента по итогам первого прохода:

1. **Схема имён файлов в `CONTENT_DIR`** — юзеру важна человекочитаемость (личная
   библиотека, просматривается руками). Вернули из `{trackId}.ext` к
   `{sanitizeTitle(title)}_{trackId}.ext` (например
   `Erik Satie - Gymnopédie No.1_abc123.mp3`). `find()` фс-стора теперь не строит точный
   путь, а сканирует `content/{mp3,mp4}/` через `readdir` и матчит по суффиксу
   `_${trackId}.${ext}` — не нужен отдельный индекс path-по-track_id, и имя остаётся
   читаемым. `sanitizeTitle()` — вырезает `/ \ : * ? " < > |` и control-символы,
   обрезает до 150 символов (запас под лимит имени файла ФС вместе с `_trackId.ext`).

2. **`findAndDeliver()` был плохо назван** — юзер справедливо не понял, что это за метод:
   он тихо совмещал "найти" и "отправить" в одном вызове, возвращая наружу только
   `boolean` — вызывающий код не видел, что где-то внутри произошла отправка. Разнесено
   на `findDeliverable(trackId): Promise<{store, track} | null>` (чистый lookup, ничего
   не отправляет) — вызывающий код (`runJob`, `handlePlaylist`) сам явно вызывает
   `hit.store.deliver(hit.track, jobId)` отдельной строкой. `download` (via
   `DownloaderPort`) как был отдельным шагом, так и остался — не то же самое, что
   `find`/`deliver`, просто оказался рядом по смыслу вопроса.

3. **Вопрос про compile-time гарантию непустого `stores`** — объяснено юзеру: `stores`
   собирается из env-конфига (`config.cacheToChannel`/`config.saveToContentDir`),
   известного только в рантайме, поэтому TS-компилятор физически не может это
   гарантировать. Максимум — рантайм fail-fast, который уже есть в `config.ts` (падает
   при загрузке модуля, до открытия БД/старта бота). Кода не меняли, только объяснение.

`bun run typecheck` чистый после всех правок.
