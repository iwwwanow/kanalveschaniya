### обзор

session-service (он же cookie-service) — сервис по авторизации, ротации аккаунтов, выгрузке куки и (частично) проксированию скачивания для ресурсов с сервисов, требующих авторизации.

**Статус: реализован первый срез (v1) в `apps/session`**, интегрирован в resolve-стадию core. Ниже — то, что реально в коде, а не черновой план. Модуль сейчас работает в **одном процессе** с core (`apps/core/src/main.ts` — композиционный корень для всего процесса, открывает и `app.db`, и `session.db`, стартует оба набора воркеров), но со своей БД (`session.db`, отдельные миграции) и собственной domain/application/infrastructure-раскладкой (`apps/session/src/`) — граница на будущее выделение в отдельный деплой заложена архитектурно (см. «границы» ниже), не только на словах.

### структура и границы

- `apps/session/src/{domain,application,infrastructure}` — зеркалит раскладку `apps/core/src/`, отдельный bun-workspace-пакет (`"session"` в `package.json`).
- **`packages/shared-queue`** — общий контракт с core: сама таблица `queue` (Drizzle `queueTable`, мигрирует core, session только читает/пишет через порт), `BlockReason`, `QueueStatus`, `MAX_RETRIES`/`backoffSeconds`. Session не импортирует core-приватные типы (`QueueItem`, `QueueRepository`) — только это.
- **`packages/shared-secrets`** (`redact`/`registerSecret`) и **`packages/shared-logger`** (тегированный логгер) — тоже общие, т.к. процесс один: секрет/лог-формат должны быть согласованы, а не задублированы.
- **Границы через consumer-owned порты** (каждая сторона объявляет порт для того, что ей нужно от другой, а не тянет чужие домен-типы):
  - `SessionContextPort` (`apps/core/src/domain/session-context.ts`) — единственное, что core знает о session: `resolveService(url)`, `getUsableCookie(serviceId)`. Реализация — `apps/session/src/application/session-context.ts`, session не импортирует этот тип (structural typing).
  - `QueueSignalPort` (`apps/session/src/domain/queue-signal.ts`) — единственное, что session знает про core-очередь: `findDistinctServiceIdsByBlockReason`, `requeueByBlockReason`. Core передаёт свой обычный `QueueRepository` — он просто структурно подходит под этот более узкий интерфейс, `apps/core/src/main.ts` явно ничего не адаптирует.
  - Оба порта соединяются в `apps/core/src/main.ts` — сейчас единственном композиционном корне всего процесса. При будущем разделении на отдельные деплои меняется только адаптер за каждым портом (HTTP-вызов вместо прямого объекта), не логика ни одной из сторон.
- `session.db` мигрирует и владеет только session (`apps/session/src/infrastructure/db/session-db.ts`); `app.db`/`telegram.db` — только core.

### принятые решения

- **Не вводим новые статусы очереди** (`pending.cookie`/`pending.account`). Переиспользуем существующий механизм `BlockReason` + `requeueByBlockReason` (уже используется для `geo`/`PROXY`). Новое значение: `needs_cookie` (`shared-queue`'s `BlockReason` enum).
  **Уточнение к более раннему черновику**: `account_banned` **не** стало отдельным `BlockReason` — бан аккаунта это терминальное `AccountStatus.Banned`, а не причина блокировки ресурсной джобы; с точки зрения ресурса забаненный аккаунт выглядит ровно как «куки пока нет» (`needs_cookie`).
- **Ресурсная джоба (`queue`) не имеет собственного счётчика попыток на cookie-flow.** Падает в `failed` / `block_reason = needs_cookie` и висит без ограничения — ровно как `geo`-джобы висят до появления `PROXY`. Разблокируется реквью-триггером (`createRequeueBlockedByService`), когда для сервиса появляется рабочий аккаунт. Новая колонка `queue.service_id` (nullable, `shared-queue`'s `queueTable`) — заполняется в момент needs_cookie-фейла (`QueueRepository.setServiceId`), чтобы реквью бил только по нужному сервису, а не по всем cookie-сервисам разом.
- **Попытка получить/обновить куки — отдельная джоба** (своя таблица `account_jobs` в `session.db`, привязана к `account_id`), со своим `status`/`retries`/`retry_after`. Дошла до `MAX_RETRIES` → `account.status = banned` (terminal). `MAX_RETRIES`/`backoffSeconds` переехали в `shared-queue` (были в core-приватном `domain/queue.ts`) — переиспользуются как есть, не задублированы.
- **Дедуп запроса на куки**: `AccountRepository.tryStartRefresh(serviceId)` — select первого `active`-аккаунта по возрастанию `id` (простейший плейсхолдер вместо ротации, см. открытые вопросы), затем conditional update `WHERE id = ? AND status = 'active'`. 0 строк или отсутствие кандидата → `null`, повторный `account_job` не создаётся.
- **Несколько аккаунтов на сервис, с ротацией.** Стратегия выбора следующего аккаунта — открытый вопрос (см. ниже), сейчас — «наименьший id». Выбор аккаунта — задача session-service; core не заботится, какой конкретно аккаунт стоит за выданной куки.
- **Proxy — 1:1 с account, с ограничением.** `accounts.proxy_id` → `proxies.id`. `UNIQUE(service_id, proxy_id)` на `accounts` — один прокси не может быть у двух аккаунтов *одного* сервиса, но может быть переиспользован аккаунтами разных сервисов.
- **Получение куки — через сторонний браузер-эмулятор** (логин-автоматизация не пишется in-house). `BrowserEmulatorPort.login(account, proxy)`, пока — `createStubBrowserEmulator()` (`apps/session/src/infrastructure/adapters/stub-browser-emulator.ts`): всегда `{ok: false, retryable: false}`, явная заглушка, не тихое отсутствие.
- **Провижининг нового аккаунта — вне автоматизации.** `tryStartRefresh` только *обновляет* уже существующий аккаунт (`active → refreshing`); если для сервиса вообще нет ни одного аккаунта — это ручной шаг (вставить строки `services`/`accounts`/`proxies` руками), не решение открытого вопроса, а осознанная граница v1.
- **Хранение куки: в `session.db`/SQLite, не S3** (не в `app.db` — уточнение относительно самого первого черновика, где предполагался общий файл). Шифрование — AES-256-GCM на уровне приложения (`apps/session/src/infrastructure/adapters/cookie-cipher.ts`), ключ из `SESSION_ENCRYPTION_KEY` (по образцу `BOT_TOKEN`, опционален — не ломает деплои без cookie-сервисов), расшифрованное значение проходит `registerSecret` (`shared-secrets`) в момент получения (`session-context.ts`), никогда не покидает границу session — core получает готовый расшифрованный temp-файл, не блоб.
- **Классификация ошибки "протухла кука" vs "не подходит" оставлена открытой** (см. ниже).
- **Межсервисная коммуникация: только через два узких consumer-owned порта** (см. «структура и границы» выше) — уточнение относительно раннего черновика «только через очередь»: очередь (`shared-queue`) — один из двух каналов, второй — `SessionContextPort` для чтения куки. Прямых импортов core-only/session-only типов друг у друга нет.
- **`deliver-job` — не то место.** Проверка "нужны ли ресурсу куки" — самое начало `runJob` в `download-job.ts` (до `getInfo`, до попытки скачивания), не `deliver-job`. Реализовано: `sessionContext.resolveService(job.url)` → если `requiresCookie` → `sessionContext.getUsableCookie(id)` → `null` ⇒ `setServiceId` + `failJob(needs_cookie)`, ничего не тратя на заведомо обречённую загрузку.
- **Куки в yt-dlp**: `DownloaderPort.download(url, { cookieFilePath })` — опциональный параметр, `yt-dlp.ts` добавляет `--cookies <path>` к обеим командам (info-фетч и сам download). Материализация/очистка temp-файла — `getUsableCookie()` (`session-context.ts`) создаёт файл в `TMP_DIR`, `cleanup()` вызывается `download-job.ts` в `finally` вне зависимости от исхода. Первый срез, не финальная дисциплина (см. открытые вопросы).
- **Известный пробел (не открытый вопрос — просто первый срез)**: `getInfo(url)` не получает cookie-файл — preflight проверяет доступность куки ДО `getInfo`, но сам `DownloaderPort.getInfo` не принимает опции. Ресурс, чья METADATA (а не только сам файл) требует авторизации, этим первым срезом не покрыт.

### открытые вопросы (не решены, специально)

- **Прокси и скачивание**: проксирование самого скачивания не привязано к session-service вообще — `download()` использует global `config.proxy`, как и раньше. Proxy аккаунта используется только в `browserEmulator.login()`. Должно ли скачивание проксироваться per-account — не решено.
- **Стратегия ротации аккаунтов**: сейчас — «наименьший id» (`tryStartRefresh`), не round-robin/LRU/random — не выбрано осознанно.
- **Различение "временный сбой вендора" vs "аккаунт забанен площадкой"** — зависит от выбора вендора, `stub-browser-emulator.ts` сейчас всегда `retryable: false`.
- **Различение "кука протухла" vs "кука никогда не подходила"** по сообщению об ошибке скачивания — не реализовано; `yt-dlp.ts` пока не матчит cookie-специфичные ошибки отдельно от generic retryable/not-retryable веток.
- **Распространение ключа шифрования между процессами** — сейчас один процесс, один env (`SESSION_ENCRYPTION_KEY`), вопрос не актуален пока не будет отдельного деплоя.
- **Дисциплина temp-файла куки** — `unlink().catch(() => {})`, best-effort, не secure wipe. Формат передачи (`--cookies <path>`) и ответственность за создание/удаление (`getUsableCookie`/`download-job.ts`) решены; секьюрность удаления — нет.

### домен (черновой флоу — контекст, как пришли к решениям выше)

- делаем попытку скачивания
- если resource относится к сервису, который нужно скачивать по куки, и есть куки — то попытка скачивания
- если ресурс относится к сервису, который нужно скачивать по куки и куки нет — сразу `failed` / `needs_cookie`, без попытки скачивания (см. «принятые решения»)
- у resource есть url — по нему выставляется `service` при первой попытке скачивания. `Service 1—* Resource`
- cookie-service (session-service) ловит `needs_cookie`-события:
  - проверяет, есть ли уже в процессе создание куки/аккаунта для этого сервиса (дедуп через `account.status`, см. выше) — если есть, пропускает
  - иначе создаёт `account_job` на аккаунт (или ротирует на другой активный аккаунт)
  - по готовности — реквьюит заблокированные ресурсные джобы этого сервиса (`requeueByBlockReason`)
- ресурсная джоба при повторном claim читает актуальную куку из `account`/`cookie` таблиц напрямую (общая БД) — очередное событие не переносит сам блоб куки, только сигнал "можно повторить"

### сущности (реализовано, `apps/session/src/domain/`)

- **service** (`service.ts`): `id, name, urlPattern, requiresCookie`. `ServiceRepository.findByUrl` — простое `url.includes(pattern)`, регистронезависимо (тот же стиль, что `isGeoBlocked` в core's `yt-dlp.ts`).
- **account** (`account.ts`): `id, serviceId, status: AccountStatus, proxyId, vendorRef`. `AccountStatus = active | refreshing | cooldown | banned` (`cooldown` зарезервирован, ничего его пока не выставляет). `vendorRef` — opaque-ссылка на профиль у вендора, TODO до выбора вендора.
- **proxy** (`proxy.ts`): `id, url`. Минимальный — только `findById`, никакой логики распределения.
- **cookie** (`cookie.ts`): `accountId (PK), blobEncrypted, createdAt, lastUsedAt`. Одна строка на аккаунт, обновление перезаписывает (`upsert`), истории нет.
- **account_job** (`account-job.ts`): `id, accountId, status: AccountJobStatus, retries, retryAfter, error`. `AccountJobStatus = pending | processing | done | failed`.
- **browser-emulator** (`browser-emulator.ts`): `BrowserEmulatorPort.login(account, proxy) -> LoginResult` (`{ok:true, cookieBlob}` | `{ok:false, error, retryable}` — та же форма, что core's `DownloadResult`).
- **queue-signal** (`queue-signal.ts`): `QueueSignalPort` — граница с core-очередью, см. «структура и границы».

### db-schema (`session.db`, `apps/session/src/infrastructure/db/schema/session.ts`)

```ts
servicesTable:    id, name (unique), urlPattern, requiresCookie
proxiesTable:     id, url, createdAt
accountsTable:    id, serviceId, status, proxyId, vendorRef, createdAt
                  — UNIQUE(serviceId, proxyId)
cookiesTable:     accountId (PK), blobEncrypted, createdAt, lastUsedAt
accountJobsTable: id, accountId, status, retries, retryAfter, error, createdAt
```

Миграция: `apps/session/drizzle/session/0000_baseline.sql` (`bun run db:generate:session`).

`shared-queue`'s `queueTable` (в `app.db`, мигрирует core) получил новую nullable-колонку `serviceId` — `apps/core/drizzle/app/0002_queue_service_id.sql`.

### application-use-cases (реализовано, `apps/session/src/application/`)

- **`createSessionContext(deps)`** (`session-context.ts`) — реализует `SessionContextPort`: `resolveService(url)` → `services.findByUrl`; `getUsableCookie(serviceId)` → активный аккаунт → его кука → `decryptCookie` → `registerSecret` → материализация во временный файл → `{filePath, cleanup}`.
- **`createEnsureAccountJobs(deps)`** (`ensure-account-jobs.ts`) — тик поллера: `queueSignal.findDistinctServiceIdsByBlockReason(NeedsCookie)` → на каждый `accounts.tryStartRefresh(serviceId)` → если аккаунт вернулся, `accountJobs.enqueue(account.id)`.
- **`createRunAccountJob(deps)`** (`run-account-job.ts`) — одна попытка: `browserEmulator.login` → успех: `encryptCookie` + `cookies.upsert` + `accounts.markActive` + job `done` + `requeueBlockedByService`; not retryable: `accounts.markBanned` + job `failed`; retryable и не исчерпан: `backoffSeconds`-реквью; исчерпан: тоже `markBanned` + `failed`.
- **`createRequeueBlockedByService(queueSignal)`** (`requeue-blocked-by-service.ts`) — тонкая обёртка над `queueSignal.requeueByBlockReason(NeedsCookie, Pending, staggerSeconds, serviceId)`.

### infrastructure (реализовано)

- Репозитории (`infrastructure/repository/`): `services-repository.ts`, `accounts-repository.ts`, `proxies-repository.ts`, `cookies-repository.ts`, `account-jobs-repository.ts` — Drizzle + `bun:sqlite`, тот же стиль, что core's репозитории.
- `infrastructure/adapters/cookie-cipher.ts` — AES-256-GCM, `scryptSync` для вывода 32-байтного ключа из `SESSION_ENCRYPTION_KEY`.
- `infrastructure/adapters/stub-browser-emulator.ts` — заглушка вендора.
- `infrastructure/workers/account-job-poller.ts` — один воркер (без `ACCOUNT_JOB_CONCURRENCY`, auth-попытки к вендору вероятно rate-sensitive), тот же double-loop-паттерн, что core's `queue-poller.ts`. Каждый тик: `ensureAccountJobs()` (дешёвый no-op в большинстве тиков) → claim+run одного `account_job`.
- `src/index.ts` — публичный API пакета `session`, плоские именованные экспорты (как core's собственный `main.ts` компонует свои куски), не один агрегирующий объект.

### wiring (`apps/core/src/main.ts`)

Композиционный корень всего процесса: открывает `sessionDb` рядом с `appDb`/`telegramDb`, создаёт session-репозитории и `sessionContext`, передаёт `sessionContext` в `createDownloadJob`, стартует `startAccountJobPoller` рядом с `startQueuePollers`. `SESSION_ENCRYPTION_KEY` не задан → предупреждение в лог, не падение (нет ни одного аккаунта — код шифрования не вызывается вообще).

### тесты

- `apps/core/tests/download-job.test.ts` — новый describe `session-service: needs_cookie preflight` (3 теста: нет куки → failed без попытки скачивания; есть кука → доходит до `download()`, cleanup вызван; сервис без `requiresCookie` → preflight no-op).
- `apps/session/tests/` — `cookie-cipher.test.ts` (round-trip, разные IV, неверный ключ), `repositories.test.ts` (`findByUrl`, `tryStartRefresh` дедуп, cookies upsert, account_jobs claim/backoff), `ensure-account-jobs.test.ts`, `run-account-job.test.ts` (success/non-retryable/retryable/exhausted), `session-context.test.ts`.

### отложено (не в первой версии)

- proxy per-account как таргетируемая настройка для скачивания (сейчас просто constraint в схеме + вход в `browserEmulator.login`, без auto-подбора для `download()`)
- вендор-специфичная обработка бана/капчи — зависит от выбора стороннего браузер-эмулятора
- managed/self-host S3 для куки — не нужно на ожидаемых объёмах
- secure-wipe для temp-файла куки (сейчас best-effort `unlink`)
- реальный `BrowserEmulatorPort` (сейчас только заглушка) и провижининг новых (не рефрешащихся) аккаунтов
- tg-bot-mention on chat to download track — не относится к session-service, отдельная фича core-бота
