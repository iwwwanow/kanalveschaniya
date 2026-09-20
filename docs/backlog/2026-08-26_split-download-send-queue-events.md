# Разделить "скачивание" и "отправку в Telegram" на разные события очереди

Обнаружено в сессии 2026-08-23 при первом сквозном тесте (после починки прокси, см. `infrastructure/docs/diary/2026-08-23_kanalveschaniya-flux-deploy.md`): трек (4.2MB) успешно скачался, но аплоад в канал упал (`socket connection was closed unexpectedly` — обрыв на стриминге большого multipart-тела через прокси-туннель). Воркер (`src/worker/index.ts`) на ретрае **перекачал трек заново**, хотя файл на диске уже был — сейчас download и upload это один джоб в общей очереди, один retry-цикл на оба шага.

Правильно — развести на два независимых события:
- `download` — скачать источник → сохранить в `content/` (или временный стейдж)
- `send`/`upload` — взять уже скачанный файл → отправить в Telegram (канал + форвард юзеру)

У них разные failure-домены (источник/`yt-dlp` vs Telegram API/прокси) и должны быть разные retry-политики/бэкоффы. Ретрай `send` не должен трогать `download`.

**Согласуется с архитектурой из `docs/diary/2026-08-22_clean-architecture-refactor.md`**: отправка в Telegram — специфичная для Telegram функция (`NotifierPort`, реализуется в `infra/telegram`). Следуя этому же принципу, сама очередь/событие/ретрай для `send`-шага тоже должны быть определены **внутри `infra/telegram`**, а не в общем `application`/queue-worker слое — общий слой не должен знать про Telegram-специфичные детали ретраев (лимиты API, размер файла, таймауты прокси). Общий `queue-poller`/domain отвечает только за `download`; передача результата на отправку — уже зона ответственности telegram-инфры (свой воркер/очередь поверх `NotifierPort`, либо отдельная таблица `telegram_send_queue` по аналогии с `telegram_reply_refs`).

Не блокирует немедленно (ретраи хоть и неэффективны, но система в итоге доезжает), но стоит сделать до рефакторинга каталогов под `domain/application/infra` — это прямо влияет на схему `queue`/`queue-item`.

**Сделано (2026-09-20)** — иначе, чем предлагала заметка: вместо отдельной `telegram_send_queue` в `telegram.db` второй этап живёт **в той же `queue`**, без Telegram-специфики. Статусы `downloaded`/`delivering`, колонки `file_path`, `deliver_retries`, `deliver_retry_after` (drizzle-миграция `0001`), `QueueRepository.claimForDelivery`. `download-job` скачивает, архивирует и кладёт файл в staging (`staged-<jobId>-…` в `TMP_DIR`); `deliver-job` (второй пул воркеров, `DELIVER_CONCURRENCY`) отправляет его в кэши/пользователю со своими ретраями — упавший аплоад больше не перекачивает трек. Потерянный при рестарте staging-файл возвращает задачу в `pending` (тратит попытку скачивания); `recoverStuckJobs` знает про `delivering`. Причина отступления: `DeliveryPort` уже доменный порт, поэтому этап доставки — тоже generic-этап, а не Telegram-очередь. Тесты — `tests/download-job.test.ts`, `tests/deliver-job.test.ts`.

