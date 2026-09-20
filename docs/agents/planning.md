# Planning: Telegram Music Bot

## Цель

Telegram-бот для скачивания музыки/видео через yt-dlp с кэшированием через приватный Telegram-канал.

Архитектура, стек, схема БД, env vars — актуальное описание в корневом `CLAUDE.md`, здесь не дублируется.
Спецификации: `docs/specs/telegram-bot.md` (хендлеры), `docs/specs/types.md` (типы/порты), `docs/diagrams/core.d2` (схема слоёв).

## Статус

Ядро + переход на clean-архитектуру (`domain/application/infrastructure`) — сделаны, смёржены, отрелизены как
**2.0.0** (`feat!`, breaking change по схеме БД: `bot.db` → `app.db`+`telegram.db`, авто-миграция на старте).
Подробная история решений и ревизий — `docs/diary/2026-08-22_clean-architecture-refactor.md`,
`docs/diary/2026-08-23_infra-restructure-plan.md`.

**Прод-деплой 2.0.0 подтверждён** (digest образа на GHCR сверен с подом на Pi, ручной перенос уже
смигрированной БД в обход медленного батчинга на SD-карте) — подробности в репозитории `infrastructure`,
`docs/diary/2026-08-24_kanalveschaniya-2.0.0-prod-migration.md`. С тех пор в код добавлено (уже в `master`,
не отражено в бэклоге, т.к. заведено по итогам инцидентов на Pi, а не ревью кода):
- `ALLOW_PLAYLIST_DOWNLOADS` (`src/config.ts`, default `false`) — плейлисты отклоняются на `getInfo()` и
  `download()`, пока явно не включено. Реакция на инцидент 2026-08-26 (SoundCloud-альбом на 1891 трек
  зависил yt-dlp в D-state под I/O-голоданием Pi).
- `/healthz` + `HEALTH_PORT` (`src/infrastructure/presentation/health-server.ts`) — heartbeat-таймер,
  503 если event loop подвис. Подключён как `livenessProbe` в манифесте `infrastructure`-репо (коммит
  `c53ad27`) — реакция на то, что зависший (не упавший) под раньше требовал ручного ребута ноды.
- 2026-09-06 (диари `2026-09-06_oom-restart-storm-research.md`): `c132158` — аплоад стримится с диска;
  `d6b691f` — `download()` безусловно отклоняет плейлист-объекты (иначе каждый следующий трек молча
  перезаписывал предыдущий на диске и в БД кэшировался чужой id/title, см.
  `docs/backlog/2026-09-06_soundcloud-sets-duration-wrong-file-cached.md`); `b0ac9a8` — geo-requeue
  растягивается по времени (стаггер 30с), чтобы не давать всплеск при холодном старте.

## Рефакторинг слоёв (ревью `docs/diagrams/core.d2`, 2026-09-20)

Итог обсуждения диаграммы против кода. Схема и код расходятся в нескольких местах, часть — реальные
нарушения границ слоёв. Порядок ниже — по зависимостям и размеру: мелкие изолированные правки первыми,
крупное переименование — последним, чтобы не ловить конфликты. **Относительно «Задач по приоритету»:**
шаги 1–8 берём *до* P0-пунктов про `process-download-job` («изолировать сторы», «split download/upload») —
они трогают тот же файл, проще делать на уже расчищенном коде.

### Шаги (по порядку выполнения)

- [x] **1. `BlockReason` и `QueueStatus` как TypeScript-`enum` в `domain/`.** Значения: `geo`, `drm`,
      `too_large`, `crashed_repeatedly`. Строки в БД не меняются — миграция не нужна. Заменяет прежнее
      решение «blockReason opaque для domain/application». `telegram-notifier` переходит на
      `Record<BlockReason, string>`/исчерпывающий `switch`; `toQueueItem` валидирует значение из БД.
      Разблокирует шаги 6 и 7. Подробности — `docs/backlog/2026-08-26_blockreason-shared-type.md`.
- [x] **2. `ErrorLogRepository`.** `domain/error-log.ts` (интерфейс, `add(jobId, url, error)`) +
      `infrastructure/repository/error-log-repository.ts`; `appDb` уходит из `ProcessDownloadJobDeps`.
- [x] **3. Use-case `getUserQueueStatus`.** `/status` перестаёт ходить в `QueueRepository` напрямую из
      `telegram-handlers`; из диаграммы уходит стрелка `presentation -> domain.repository`.
- [x] **4. `TelegramUsersRepository`.** Сырой `INSERT OR IGNORE INTO users` уходит из handlers в
      репозиторий рядом с `reply_refs`/`track_refs`; `telegramDb` уходит из `TelegramHandlersDeps`.
      Use-case не нужен — `users` это telegram-понятие, не домен. Связано с открытым вопросом про
      `users.username` (см. «Открыто» ниже).
- [x] **5. `DeliveryPort` вместо duck-typing (`isTrackCachePort`).** `DeliveryPort { deliver(track, jobId) }`
      реализует `telegram-channel-cache` вместе с `TrackStorePort`; application получает его отдельным
      параметром.
- [x] **6. `recover-stuck-jobs` → use-case в application.** Новых сущностей не требует (нужны только
      `QueueRepository`, `NotifierPort`, `DownloadResult`, `MAX_RETRIES`/`backoffSeconds`,
      `BlockReason.CrashedRepeatedly`); вместо глобального `logger` — `WorkerLog`. Зависит от шага 1.
- [x] **7. Geo-requeue из `yt-dlp.ts` → use-case `requeueBlockedJobs({ reason, staggerSeconds })`.**
      Условие «PROXY задан» остаётся в `main.ts` (конфигурация). Адаптер загрузчика не должен управлять
      очередью. Зависит от шага 1.
- [x] **8. `telegram-send-media` → `infrastructure/adapters/telegram-client/`.** Общий хелпер двух адаптеров
      (`channel-cache`, `notifier`), порт не реализует — в диаграмме отдельным узлом вне `adapters`.
- [x] **9. Переименование Track → Resource в коде** (~169 вхождений в 21 файле): `Track`, `TrackStorePort`,
      `TrackCachePort`/`DeliveryPort`, `trackId`, `track-cache.ts`, `telegram-track-refs*`. Крупное, отдельным
      заходом, после шагов 1–8.
- [x] **B. Удалён `migrate-legacy`** (одноразовая миграция `bot.db` → `app.db`, на проде давно no-op; код в git-истории, тег `v2.0.3`).
- [x] **A. `too_large`**: теперь `failed` + `blockReason=too_large` (раньше `done` без причины).
- [x] **Доки синхронизированы:** `CLAUDE.md` (структура, БД, env, без `geo_blocked`), `docs/specs/types.md` (Resource, enum'ы, `DeliveryPort`).
- [x] **10. Колонки БД переименованы** (`queue.track_id`/`resource.track_id` → `resource_id`,
      `telegram_track_refs` → `telegram_resource_refs`, её `track_id` → `resource_id`). Идемпотентно на старте
      (`infrastructure/db/schema-utils.ts`), проверено на копии БД со старой схемой и данными, повторным запуском
      и на свежей БД. **Не откатывается на старый образ** — перед деплоем на Pi сделать копию `DATA_DIR`.
- [x] **11. Диаграммы.** Обновить `core.d2` (`vars.d2-config.layout-engine`, `direction`, убрать/пометить
      `telegram_send_queue`, реальные имена узлов, `telegram-notifier`, `recover-stuck-jobs`, `health-server`,
      `db`, `main` как composition root) и написать `docs/diagrams/infrastructure.d2` (три шва Telegram:
      вход, выход, хранилище/доставка). Делать после шагов 1–8 — чтобы не рисовать протечки, которые убираем.
- [ ] **12. Drizzle** — после шагов 2–4, когда весь SQL окажется внутри репозиториев (см. P2).

### Открытые вопросы

- Шаг 10 (колонки БД `track_id` → `resource_id`): решает пользователь — миграция на боевых данных Pi,
  откат на старый образ станет несовместим со схемой. Пока `track_id` в схеме — исторический артефакт
  (см. `CLAUDE.md`, «Database»).
- Закрыто 2026-09-20: `too_large` сохраняет `blockReason` (статус `failed`); `CLAUDE.md` синхронизирован
  с кодом (`geo_blocked` убран, структура папок и env-переменные обновлены).

## Задачи по приоритету

### P0 — надёжность в проде

- [ ] **Ошибки скачивания yt-dlp не ретраятся — `retryable` нигде не читается (регресс 2.0.0).**
      `yt-dlp.ts` в `download()` ловит любую ошибку и возвращает `{ ok:false, retryable:true }`, а
      `process-download-job.ts` на любой `!result.ok` безусловно вызывает `failPermanently` — задача сразу
      `failed` с `retries=0`, пользователю уходит «превышено число попыток», хотя попытка была одна.
      Проверено на реальной SQLite 2026-09-20. Ретраи с backoff (30/60/120с) работают только для
      *исключений* (`getInfo`, `store.save/deliver`, `notify`). До рефакторинга (`src/worker/index.ts`,
      коммит `2000e4a^`) ошибка скачивания бросалась и ретраилась, кроме geo/404. Фикс: при
      `retryable: true` идти в ветку retry/backoff, `failPermanently` — только при `retryable: false`;
      добавить сценарий в проверку. Затрагивает поведение прода — отдельное решение.
- [x] **Бесконечный краш-луп на больших/длинных треках — исправлено.** При падении всего процесса
      (OOM-kill/рестарт пода) джоба оставалась в `processing`, и на старте (`app-db.ts`) просто
      сбрасывалась в `pending` без инкремента `retries` — обычный retry/backoff в
      `process-download-job.ts` считает попытки только при исключении *внутри* процесса, не при его
      смерти целиком. Итог — крах никогда не засчитывался как попытка: трек крашит процесс → рестарт →
      джоба снова `pending` с тем же `retries` → берётся заново → крашит снова, без конца.
      Фикс — `domain/queue.ts` (`MAX_RETRIES`/`backoffSeconds` вынесены как общие), новый
      `recover-stuck-jobs` (сначала `infrastructure/workers/`, с 2026-09-20 use-case в
      `application/recover-stuck-jobs.ts`; вызывается из `main.ts` до старта поллера): застрявшие `processing`-джобы засчитывают крах как попытку;
      если попытки исчерпаны — уходят в `failed` с `blockReason: "crashed_repeatedly"` и явным
      уведомлением пользователю, а не возвращаются в очередь молча.
- [ ] **Превентивный фильтр по длительности/размеру трека — ещё не начат.** Обсуждался отдельно:
      `--match-filter "duration < N"` в yt-dlp (до старта скачивания, в отличие от текущей
      post-download проверки на 50MB) — не даёт вообще начать качать трек, который потом всё равно
      будет неприемлем. Юзер сейчас подбирает конкретный порог. Отдельный открытый вопрос по дизайну —
      что делать с превышающими порог треками: сразу `failed`+уведомление, или отдельный флаг в
      очереди (`download_later`) с ручным/плановым возвратом в обработку позже — решение не принято.
- [ ] **Upload буферизует файл целиком в память → OOM на длинных треках — исправлено в коде, не подтверждено
      на проде.** Коммит `c132158` (`fix(telegram): stream uploads from disk`): `readFile` + `Blob` заменены на
      `Bun.file(path)` в `FormData` (`adapters/telegram-client/send-media.ts`), двойная буферизация ушла. Гипотеза
      «`Bun.file().size` даёт тот же known-length, что `Blob`, и CONNECT-прокси не рвёт соединение» **не проверена
      вживую** (диари 2026-09-06). Оставить открытым до проверки на Pi с длинным треком; из «самого горячего»
      снято. Подробности — `docs/backlog/2026-08-26_upload-buffers-full-file-oom.md`.
- [ ] **Разделить "download" и "upload" на разные события очереди.** Сейчас один retry-цикл на оба шага —
      если падает только аплоад в Telegram, трек перекачивается заново.
      Подробности — `docs/backlog/2026-08-26_split-download-send-queue-events.md`.
- [ ] **Изолировать сторы друг от друга в `process-download-job`.** Если падает канал (например, бот не
      добавлен в чат), fs-архив тоже не сохраняется — хотя формально не должен зависеть от канала.
      После разделения на `caches`/`archives` (2026-09-20) это два независимых цикла — правка стала проще.
      Подробности — `docs/backlog/2026-08-26_isolate-stores-process-download-job.md`.
- [ ] **fs-only cache-hit не переиспользуется.** При `CACHE_TO_CHANNEL=false` повторный запрос того же
      трека скачивает его заново вместо переиспользования файла на диске.
      Подробности — `docs/backlog/2026-08-26_fs-only-cache-hit-no-deliver.md`.
- [x] **Быстрый отказ для DRM-треков — сделано.** `isDrmProtected` в `yt-dlp.ts` → `BlockReason.Drm`,
      `retryable: false`, сразу `failed` + понятное сообщение пользователю (`telegram-notifier`).
      Подробности — `docs/backlog/2026-08-26_drm-tracks-fast-fail.md`.

### P1 — инфраструктурные ошибки/задачи

- [ ] **Контейнеризовать telegram-прокси.** Сейчас SSH-туннель + privoxy — ручной стопгэп на хосте Pi,
      не в GitOps. Целевая реализация — в репозитории `infrastructure`.
      Подробности — `docs/backlog/2026-08-26_containerize-telegram-proxy.md`.
- [ ] **Pi 3B+ не тянет control plane (k3s+Flux) одновременно с ботом — не устранено.** Root cause
      (`infrastructure/docs/backlog/2026-08-26_pi3b-resource-starvation-flux-crashloop.md`): 955Mi RAM,
      Flux-контроллеры уходят в непрерывный `CrashLoopBackOff`/I/O-wait, бот из-за этого зависает
      (не крашится) и требует ручного ребута ноды. Повторилось 2026-08-27 уже без плейлист-триггера
      (`infrastructure/docs/backlog/2026-08-27_pi-down-again-no-playlist-trigger.md`) — значит
      `ALLOW_PLAYLIST_DOWNLOADS` не первопричина, а лишь убрал один из усугубляющих факторов.
      Митигация уже есть (мониторинг `pi-resource-monitor.sh` + `/healthz`-liveness, см. «Статус» выше),
      но сама нехватка ресурсов (resource limits Flux-контроллеров/разнесение по времени/апгрейд железа)
      — решение и работа целиком в репозитории `infrastructure`, не в этом. Не блокирует код бота,
      но объясняет периодическую недоступность в проде — держать в виду при разборе будущих "бот не отвечает".

### P2 — технический долг / мелкий рефакторинг

- [ ] `extractUrl` не находит ссылку внутри произвольного текста сообщения (только если всё сообщение —
      валидный URL). Подробности — `docs/backlog/2026-08-26_extract-url-inline-text.md`.
- [x] `blockReason` — общий словарь строк (`"geo"`/`"drm"`/`"too_large"`) без единого типа, риск опечатки.
      Подробности — `docs/backlog/2026-08-26_blockreason-shared-type.md`. **→ вошло в «Рефакторинг слоёв», шаг 1.**
- [ ] Мусор в `queue` — `error`/`block_reason` не чистятся при успешном `done`, `track_id` не пишется
      обратно в БД. Подробности — `docs/backlog/2026-08-26_queue-stale-error-track-id-cleanup.md`.
- [x] `error_log`-запись в обход репозитория — единственное место в `application/`, где код бьёт по
      `Database` напрямую. Подробности — `docs/backlog/2026-08-26_error-log-write-bypasses-repository.md`.
      **→ вошло в «Рефакторинг слоёв», шаг 2.**
- [ ] `NotifierPort`/`TrackCachePort` пересекаются по ответственности (оба резолвят `jobId→chatId` и шлют
      в Telegram) — не блокирует, пересмотреть при третьем похожем кейсе.
      Подробности — `docs/backlog/2026-08-26_notifier-trackcache-overlap.md`. Частично затрагивается шагом 5
      «Рефакторинга слоёв» (`DeliveryPort` вместо `TrackCachePort`).
- [x] `migrateLegacyDb` — без батчинга транзакций. **Снято 2026-09-20: миграция удалена** (прод давно на
      `app.db`, код в git-истории, тег `v2.0.3`). Подробности — `docs/backlog/2026-08-26_migrate-legacy-db-no-batching.md`.
- [ ] Drizzle вместо ручного `bun:sqlite` — сознательно отложено, путь миграции описан и остаётся открытым.
      Подробности — `docs/backlog/2026-08-26_drizzle-migration-deferred.md`.
- [ ] UX-тексты бота — юзер правит сам, не через агента.
      Подробности — `docs/backlog/2026-08-26_bot-ux-text-cleanup.md`.

## Фичи

- [ ] **Форвардить в канал исходное сообщение вместе с треком.** Сейчас в канал уходит только сам файл —
      нужно вместе с ним форвардить (`ctx.telegram.forwardMessage`) исходное сообщение пользователя, чтобы
      в канале сохранялся контекст «откуда» трек. Технически подтверждено — `forwardMessage` умеет
      форвардить из личного чата с ботом в канал напрямую. Простая фича, не начата.

## Сложные фичи (осознанно в конце очереди)

- [ ] **Cookies для yt-dlp (SoundCloud-авторизация).** Часть треков не скачивается без залогиненной
      сессии (yt-dlp issue #8390). Сложная фича (код + k8s Secret + операционный ре-экспорт), не начата.
      Открытый вопрос: удобного способа экспортировать cookies с телефона не нашли (HttpOnly-куки требуют
      браузерное расширение с `chrome.cookies` API — букмарклет/голый JS не сработает).
      Подробности — `docs/backlog/2026-08-26_yt-dlp-soundcloud-cookies.md`. Пока не зафиксировано в
      `docs/diagram.d2`/`docs/specs/types.md` — до момента, когда фича станет актуальна.

## Хостинг / инфраструктура (done, для контекста)

- [x] Бот перенесён на домашний Raspberry Pi 3B+ + k3s (учебная цель заодно), задеплоен через GitOps и
      отвечает в Telegram. Стабильность control plane (k3s+Flux) на этом железе — под вопросом, см. P1
      выше. **GitOps-манифесты и вся дальнейшая работа по кластеру — в отдельном репозитории
      `infrastructure`** (не здесь) — см. его `docs/k3s-flux-bootstrap.md`. Подключение — `ssh pi`.
      Подробности по железу/сети — `docs/diary/2026-08-19_raspberry-pi-hosting.md`.

## Открыто, решение отложено (не забыть)

- `users.username` — telegram-профильная деталь в generic-таблице `users`, нигде не читается обратно.
  Кандидат на переезд в `infrastructure` (`telegram_users`) либо удаление. Решение отложено, не блокирует.
- `docs/agents/planning.md`/`docs/agents/list.md`/`docs/agents/testing.md` живут в `docs/agents/`-вложенности,
  что не совпадает с каноном из корневого `~/CLAUDE.md` (плоский `docs/`). Юзер решит сам, переносить ли.
