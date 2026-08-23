# 2026-08-22 — переход на clean-архитектуру (application + infra)

Сессия — обсуждение архитектуры (код не трогали) + проверка GitHub Actions + ревью
итоговой схемы в `docs/diagram.d2`.

## GitHub Actions — сделано

`gh auth status` возвращал `HTTP 401 Bad credentials` — токен для аккаунта `kirill-ivanovvv`
протух. Починка оказалась не тривиальным `refresh`, а сменой активного аккаунта:

- `gh auth refresh -h github.com` **не сработал** — ругался на mismatch
  (`received credentials for iwwwanow, did you use the correct account in the browser?`),
  потому что репозиторий принадлежит организации/юзеру `iwwwanow`, а не `kirill-ivanovvv`.
- Починка: `gh auth login -h github.com` (чистый логин, не refresh) → выбрать аккаунт
  `iwwwanow` в браузере → стал активным автоматически.
- Старую битую запись `kirill-ivanovvv` можно убрать: `gh auth logout -h github.com -u kirill-ivanovvv`
  (необязательно, просто мусор).
- **Важно на будущее**: правильное имя репозитория — `iwwwanow/kanalveschaniya`
  (без префикса `iwwwanow_` в названии самого репо — этот префикс есть только в пути каталога
  на диске, `iwwwanow_kanalveschaniya`). `gh run list --repo iwwwanow/iwwwanow_kanalveschaniya`
  падает 404, правильно — `gh run list --repo iwwwanow/kanalveschaniya`.

Результат проверки: последний прогон CI (коммит `3a52e73`, 2026-08-19) — **success**
(release + docker jobs). Actions работоспособны.

## Архитектура: итоговое решение

Схема слоёв (рисует пользователь отдельно, здесь — словесная фиксация решений):

```
domain/           — только типы (Track, QueueJob, DownloadResult) + порты (интерфейсы):
                     QueueRepository, TrackRepository, DownloaderPort, NotifierPort.
                     Никакого entity/value-object слоя — оверинжиниринг для этого проекта.
                     "domain" здесь = контракты, а не поведенческая модель.

application/      — use-cases:
                     - EnqueueDownload   (юзер прислал url → создать job в очереди)
                     - ProcessDownloadJob (взять job → скачать → закешировать → notify)
                     notify user — часть ProcessDownloadJob (естественное завершение
                     жизненного цикла джобы, не отдельный use-case), но вызывается
                     через порт NotifierPort — сам use-case Telegraf не знает.

infra/
  downloader/      — YtDlpDownloader, реализует DownloaderPort (адаптер вокруг Bun.spawn yt-dlp)
  db/               — sqlite-репозитории, реализуют QueueRepository/TrackRepository
  telegram/
    bot/            — presentation-адаптер (driving): /start, /status, приём url, парсинг,
                       вызов use-cases. Также реализует NotifierPort.
    channel-cache/  — infra-адаптер (driven): TrackCachePort через приватный канал
                       (upload/forward/поиск file_id)
```

## Ключевые решения по ходу обсуждения

1. **Telegram — это два разных адаптера, не один.** `bot/` (presentation, driving —
   вызывает use-cases) и `channel-cache/` (infra, driven — реализует порт, вызывается
   use-case'ом). Смешивать в один "telegram-adapter" не стали — разная роль в
   hexagonal-архитектуре, разная тестируемость.

2. **Хранение chat_id/message_id для реплая юзеру — отдельная таблица, целиком в infra.**
   Сейчас в `queue` только `user_id` (бот шлёт просто DM, реплая на конкретное сообщение нет).
   Чтобы добавить реплай, НЕ расширяем `queue` полями телеграма — заводим отдельную таблицу:

   ```sql
   CREATE TABLE telegram_reply_refs (
     job_id     INTEGER PRIMARY KEY,
     chat_id    INTEGER NOT NULL,
     message_id INTEGER NOT NULL
   );
   ```

   Владелец — целиком `infra/telegram`, ни один use-case/domain-тип про неё не знает.

   Поток:
   - `bot` (presentation) вызывает `EnqueueDownload` → получает `jobId` через generic
     `QueueRepository`.
   - `bot`-адаптер сам, отдельным вызовом, пишет `TelegramReplyRepository.save(jobId, chatId, messageId)`.
   - Когда `ProcessDownloadJob` завершается и зовёт `NotifierPort.notify(jobId, result)` —
     это реализация в `infra/telegram/bot`: внутри метода адаптера делает **свой** lookup
     `TelegramReplyRepository.get(jobId)`, потом `sendMessage`/reply.

   Это осознанный доп. DB round-trip прямо в методе инфра-адаптера (не в use-case) —
   решили, что это нормально: одна и та же локальная SQLite, цена лишнего SELECT
   незначительна, а изоляция domain/application от специфики Telegram того стоит.
   Альтернативу (opaque-поле `reply_ref` прямо в `queue`, транзитом через use-case)
   отклонили — она смешивает владение схемой таблицы даже если код не лезет в поле.

## Финальная схема (docs/diagram.d2) — согласована

```
infrastructure -> application -> domain

infrastructure: {
  presentation: { telegram-bot }
  adapters: { yt-dlp }
  repository: { telegram, sqlite }
  workers: { queue-poller }
}

application: {
  use-cases: { enqueue-download, process-download }
}

domain: {
  interfaces: { download-result, queue-item, resource }
  ports: { downloader, notifier }
  repository: { queue, resource }
}
```

Ревью прошло в 2 раунда, оба замечания учтены в файле:

1. **`infrastructure.repository: { telegram, sqlite }`** — реплаи (chat_id/message_id → job_id)
   и трекинг сообщений в канале теперь под `telegram`-компонентом (не имплементирует
   доменные порты — приватная зона telegram-bot), `sqlite` — отдельно, имплементирует
   `domain.repository.queue`/`resource`. Физически обе — одна и та же SQLite-база
   (`data/bot.db`), разделение логическое (владение таблицами), не по технологии —
   важно не развести это случайно на две базы при реализации.
2. **`queue-item` вместо `queue-job`** (domain.interfaces) — сняло конфликт имён с
   use-case `process-download` (use-case про "download", очередь — про "item").

Все use-case'ы, порты и разделение telegram на presentation (`telegram-bot`, driving) vs
repository (`telegram`, driven, реплаи+channel) — зафиксированы, вопросов не осталось.
Схема готова как основа для рефакторинга каталогов.

## Хендлеры бота — согласованы, зафиксированы в `docs/specs/telegram-bot.md`

Итоговый список (все решения — детально в спеке, тут только суть):

- **`handle-message`** — сообщение боту в личке со ссылкой → `EnqueueDownload`.
  Отдельно `/start`, `/status` как command-хендлеры, не generic message.
- **notify** — не хендлер, завершение `process-download` через `NotifierPort`:
  пост в канал → reply файлом на исходное сообщение. Reply-target обобщён
  (`{chatId, messageId}`), работает и для личного чата, и для канала.
- **`listen-channel`** — admin-only команда-переключатель, включает
  `channel_post`-листенер. Ссылка в новом посте → та же `EnqueueDownload`.
  Фильтр от собственных ответов бота: пропускать сообщения с непустым
  `reply_to_message` (в приватном канале реплаит только бот) — надёжнее чем
  полагаться только на паттерн URL (caption потенциально может содержать ссылку).
- **`handle-channel-history`** — admin-only команда, но **заглушка**.
  Реальный бэкафилл истории канала **не реализуем**: у Telegram Bot API нет
  метода получить историю чата/канала (`getChatHistory` не существует в Bot API),
  только real-time `channel_post`. Нужен MTProto-клиент (userbot, gramjs/mtcute,
  авторизация по номеру телефона) — вне текущего scope (в проекте только
  `telegraf`). Команда просто отвечает "не реализовано, нужен MTProto".
- Обе admin-команды (`listen-channel`, `handle-channel-history`) требуют проверку
  что вызывающий — админ/владелец.
- **Идемпотентность** (на случай если `handle-channel-history` всё же будет
  реализован через MTProto): не полагаться на локальную БД, а проверять сам
  канал — сообщение со ссылкой считается обработанным, если у него есть
  reply с `reply_to_message_id`, равным его id. Удалили файл из канала →
  реплая нет → следующий проход перекачивает заново. Локальная БД
  (`queue`/`telegram_reply_refs`) — только для дедупа *внутри* очереди
  (не пересекается с этой проверкой).

## Обновление 2026-08-23 — две физические SQLite-БД вместо одной

Продолжение обсуждения из сессии выше (`telegram_reply_refs`, предложенная
`telegram_send_queue`) — решили пойти дальше логического разделения "один файл,
разделение по владению таблицами" и завести **два физических файла**:

- `data/app.db` — application/domain-owned: `queue`, `resource` (таблица `tracks`).
  Реализует `domain.repository.queue`/`resource`, про эту БД знают use-cases
  через порты, никакой telegram-специфики.
- `data/telegram.db` — telegram-owned: `telegram_reply_refs`, `telegram_send_queue`.
  Целиком приватная зона `infra/telegram`, не имплементирует domain-порты.

Технически тривиально — `bun:sqlite` открывает независимые файлы через два
`new Database(path)`, шарить коннект не нужно. Причина изменить решение —
усилить изоляцию с логической (один файл, но домены не лезут в чужие таблицы)
до физической (домены физически не могут дотянуться до чужих таблиц без
явного второго клиента).

**Осознанно теряем**: атомарные транзакции между `queue` и telegram-таблицами
(SQLite умеет это только через `ATTACH DATABASE` в одном коннекте, не между
двумя независимыми `Database`-инстансами). Не считается регрессией — это уже
было решено не в один шаг делать: lookup `telegram_reply_refs` по `job_id` в
`NotifierPort`-реализации и так зафиксирован как отдельный round-trip, не JOIN
и не совместная транзакция с `queue`.

**Следствие для реализации**: `runMigrations()` тоже разделяется на два набора,
каждый привязан к своей БД/своему `Database`-инстансу, а не один общий список
как сейчас в `src/db/schema.ts`.

Схема обновлена в `docs/diagram.d2` — `infrastructure.repository.sqlite` (app.db)
и `infrastructure.repository.telegram` (telegram.db) теперь отдельные под-узлы
с перечислением таблиц внутри каждого.

## Обновление 2026-08-23 — geo_blocked не должен быть литералом в generic queue.status

Заметили течь: текущая схема (см. `CLAUDE.md`, актуальный код) держит
`geo_blocked` прямо в `queue.status` вместе с generic `pending/processing/done/failed`.
Это протаскивает знание о конкретной классификации ошибки yt-dlp (гео-ограничение)
вверх, в generic `domain.repository.queue`/`application`, которые видеть это не должны —
симметрично тому же принципу, по которому Telegram-детали не лезут в domain (см. выше
про `NotifierPort`).

**Решение**:

- `queue.status` остаётся строго generic: `pending | processing | done | failed`.
  `geo_blocked` из статуса убираем.
- `queue.error` (уже есть) — свободный текст, как и был.
- Добавляем `queue.block_reason TEXT` — **opaque** для domain/application. Use-case
  (`ProcessDownloadJob`) не интерпретирует значение, просто сохраняет то, что вернул
  `DownloaderPort` в `DownloadResult` (failure + опциональный `blockReason`).
- Классификация "это именно гео-блок" происходит целиком в `infra/downloader/yt-dlp` —
  адаптер парсит stderr/exit yt-dlp и сам решает, что записать в `blockReason`
  (например строку `'geo'` — но это его собственное значение, не часть контракта,
  который domain обязан понимать).
- Логика «на старте, если задан `PROXY`, реквьюить джобы с `block_reason='geo'`» —
  завязана сразу на два инфра-детали (env `PROXY` + конкретное значение `'geo'`,
  придуманное yt-dlp-адаптером) и **не принадлежит ни application, ни domain**.
  Место — либо сам `infra/downloader/yt-dlp` (экспортирует функцию
  `requeueGeoBlockedIfProxyAvailable(queue: QueueRepository, proxy?: string)`),
  либо composition root `main.ts`, который и так единственный, кому разрешено
  сшивать инфра-детали друг с другом. Метод порта `QueueRepository` при этом
  остаётся полностью generic — `requeueByBlockReason(reason, newStatus)`,
  просто UPDATE по opaque-строке, порт не знает, что такое «geo».

## Обновление 2026-08-23 — TrackCachePort вернули в схему

`TrackCachePort` был задуман ещё в первой секции этого файла («channel-cache/ —
infra-адаптер (driven): TrackCachePort через приватный канал») но не попал в финальный
`docs/diagram.d2` (`domain.ports` остались только `downloader`, `notifier`). Вернули —
подробная сигнатура и обоснование (почему `Port`, а не `Repository`) — в
`docs/specs/types.md`.

Коротко: `TrackCachePort` абстрагирует раздачу уже скачанного трека через механизм
доставки (сейчас — Telegram-канал), а не просто хранение метаданных — поэтому `Port`,
как `NotifierPort`/`DownloaderPort`, а не `Repository`, как `QueueRepository`/`ResourceRepository`.
`deliver(track, jobId)` берёт opaque `jobId`, не `chatId`/`messageId` — telegram-адрес
резолвится внутри реализации (`infra/telegram/channel-cache`) через lookup в
`telegram_reply_refs`, тем же паттерном, что уже принят для `NotifierPort`.

`docs/diagram.d2` также поправлен по структуре зависимостей: одна общая стрелка
`infrastructure -> application -> domain` заменена на точную картину — только
`infrastructure.presentation` реально зависит от `application` (зовёт use-cases),
а `infrastructure.repository`/`infrastructure.adapters` (driven-адаптеры, реализуют
domain-порты) зависят только от `domain`, `application` им не нужен вообще.

## Обновление 2026-08-23 — аудит архитектуры: похожие течи на geo_blocked

По просьбе ревью текущего кода (`src/`) на предмет данных, живущих не в том слое —
той же природы, что и `geo_blocked` в `queue.status`. Приоритет по уверенности:

1. **`tracks.channel_message_id` (`src/db/schema.ts:31-39`) — HIGH, самая прямая
   аналогия.** `tracks` — будущий `domain.repository.resource`, generic-кэш метаданных
   трека. `channel_message_id` — чистая telegram-деталь, ей там не место, ровно тот же
   класс течи, что и `chat_id`/`message_id`, которые уже вынесены в
   `telegram_reply_refs`. Симметричный фикс: `channel_message_id` уезжает в
   `telegram_track_refs` (`data/telegram.db`), `tracks`/`resource` остаётся чисто
   доменным (`track_id, url, title, duration, is_video, cached_at`). Именно это
   и стало поводом вернуть `TrackCachePort` (секция выше) — раздача файла из кэша
   нуждается в отдельном порту, а не в поле в generic-таблице.

2. **Классификация ошибки geo/404 (`src/worker/index.ts:26-36`, `isGeoBlocked`/
   `isNotFound`) — код-манифестация уже найденной течи.** Парсинг raw stderr yt-dlp
   сейчас происходит в generic worker-loop (будущий `application`), а не в
   `downloader.ts` (будущий `infra/downloader/yt-dlp`). `download()`/`getInfo()`
   (`downloader.ts:77-118`) кидают голый `Error` с обрезком stderr — классификация
   происходит снаружи адаптера. Фикс: `DownloaderPort`-реализация должна сама
   классифицировать и возвращать typed `DownloadResult` (`{ok:false, blockReason:'geo',
   retryable:true}`), а не кидать голый `Error`, который парсит вызывающий код.

3. **Worker дёргает Telegram API напрямую (`src/worker/index.ts`, множество мест:
   строки 103, 112, 173, 191, 210, 221, 248, 253) — самая объёмная по коду.**
   `runWorker(bot: Telegraf, ...)` получает живой `Telegraf`-инстанс и напрямую зовёт
   `bot.telegram.forwardMessage`/`sendMessage`. Это будущий `ProcessDownloadJob`
   use-case, который должен звать только `NotifierPort`/`TrackCachePort`, ничего не
   зная о Telegraf. Ожидаемо — это то, что чинит сам рефакторинг каталогов, но
   отдельно стоит держать в виду как самый крупный кусок работы.

4. **Presentation минует application, ходит в SQL напрямую (`src/bot/handlers.ts:26-30,
   57-61, 70-74, 80`).** Хендлер бота сам пишет SQL к `queue`/`tracks`/`users` в обход
   `QueueRepository`/`ResourceRepository`/use-case'ов. `EnqueueDownload` сейчас не
   существует как отдельная функция — логика размазана внутри текстового хендлера.
   Схлопывается в use-case при рефакторинге.

5. **`users.username` (`src/db/schema.ts:5-9`) — LOW, под вопросом.** `users` не
   scoped под telegram, но `username` — чисто telegram-профильная деталь, нигде не
   читается обратно в бизнес-логике (только пишется при апсерте,
   `handlers.ts:51-54`). Domain'у для `QueueItem.userId` достаточно opaque numeric id.
   Кандидат на переезд в `infra/telegram` (`telegram_users`) либо на удаление, если
   реально не используется — решение отложено, не блокирует остальное.

## Смежная тема, не в этом файле

**Cookies для yt-dlp (SoundCloud-авторизация)** — отдельная сложная фича, обсуждена
и зафиксирована в `docs/backlog-cookies.md` (не здесь, чтобы не смешивать топики).
Пересекается с этим рефакторингом: предлагаемый `CookieRepository` следует тому же
принципу `Repository` vs `Port`, что и `TrackCachePort` выше (чистое хранение по
ключу → `Repository`, не `Port`), а расширение `DownloaderPort` доп. параметром
`cookiesPath` — тот же паттерн, что уже применён для `blockReason`/geo-классификации
(развилка внутри `infra/downloader/yt-dlp`, не в domain/application). Пока не
зафиксировано в `docs/diagram.d2`/`docs/specs/types.md` — сознательно, до момента
когда фича станет актуальна для реализации.

## Остаток работы

- [x] Типы (`domain/types.ts` + `infra/telegram/types.ts`) прописаны как черновик
      в `docs/specs/types.md` — Track, QueueItem, DownloadResult, порты
      (QueueRepository, ResourceRepository, DownloaderPort, NotifierPort, TrackCachePort),
      TelegramReplyRef, TelegramTrackRef, TelegramSendQueueItem. Ещё не перенесены в код.
- [ ] Аудит архитектуры (секция выше, 5 находок) — исправления в коде не начаты:
      `tracks.channel_message_id` → `telegram_track_refs` (находка №1, повод для
      `TrackCachePort`), классификация geo/404 → в `downloader.ts` (№2), worker
      напрямую дёргает Telegraf (№3), presentation напрямую в SQL (№4),
      `users.username` (№5, решение отложено)
- [ ] Собственно рефакторинг структуры каталогов под `domain/application/infra` по схеме
      `docs/diagram.d2` — не начинали, только спроектировали
- [ ] Реализация хендлеров бота по `docs/specs/telegram-bot.md`
      (`handle-message`, `listen-channel` + фильтр по `reply_to_message`, admin-auth,
      `handle-channel-history` как заглушка)
- [ ] Схема `telegram_send_queue` (status/attempts/retry_after/error, тот же
      backoff-паттерн 30s→60s→120s что у основного `queue-poller`) +
      `infra/telegram/workers/send-queue-poller.ts` — спроектировано, не реализовано.
      Подробности — секция «две физические SQLite-БД» выше.
- [ ] Переход на две физические БД (`data/app.db` + `data/telegram.db`) вместо
      текущей единой `data/bot.db` — миграция данных при реализации рефакторинга,
      `runMigrations()` разделяется на два независимых набора.
- [ ] Убрать `geo_blocked` из `queue.status`, завести `queue.block_reason TEXT`
      (opaque для domain/application) + вынести классификацию гео-блока и
      реквьюинг на старте в `infra/downloader/yt-dlp` — см. секцию выше.
      **Меняет** текущую реализацию (`geo_blocked` сейчас реальный статус в проде,
      см. `CLAUDE.md`) — при рефакторинге это миграция данных, не только схемы.
- [ ] Форвард исходного сообщения вместе с треком в канал — фича из
      `docs/agents/planning.md` («Бэклог: фичи»), технически подтверждено что
      `forwardMessage`/reply-target для этого достаточно, отдельной инфры не требует
- [ ] Вынести "текст → валидный URL или null" в общую чистую функцию — сейчас,
      видимо, где-то в `bot/handlers.ts`, нужна для переиспользования между
      `handle-message` и `listen-channel`
- [ ] `Bun.cron()` — обсуждали как нативный планировщик Bun (minute-granularity, no-overlap
      guarantee); для основного `queue-poller` не подходит (нужна суб-минутная реакция,
      оставляем poll-loop), но пригодится для будущих периодических задач
      (sweep зависших `failed`/заблокированных по `block_reason`, очистка `TMP_DIR`) —
      не реализовывали, просто вариант на заметку
