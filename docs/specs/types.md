# Типы — domain и infra/telegram

Типы и порты clean-архитектуры (`domain`/`application`/`infra`,
см. `docs/diagrams/core.d2` и `docs/diary/2026-08-22_clean-architecture-refactor.md`). Актуальный код — `src/domain/*.ts` (обновлено
2026-09-20: `Resource` → `Resource`, enum'ы `QueueStatus`/`BlockReason`, `DeliveryPort`).

## `domain/types.ts`

Знает про них весь `application` (use-cases) и все `infra`-адаптеры, реализующие
domain-порты. Никакой telegram- или yt-dlp-специфики здесь быть не должно.

```ts
// entities
enum QueueStatus { Pending = "pending", Processing = "processing", Done = "done", Failed = "failed" }
enum BlockReason { Geo = "geo", Drm = "drm", TooLarge = "too_large", CrashedRepeatedly = "crashed_repeatedly" }

type Resource = {
  resourceId: string;
  url: string;
  title: string;
  duration: number;
};

type QueueItem = {
  id: number;
  url: string;
  resourceId: string | null; // null до разворачивания плейлиста
  userId: number;
  status: QueueStatus;
  error: string | null;
  blockReason: BlockReason | null;
  retries: number;
  retryAfter: number | null;
  createdAt: number;
};

type DownloadResult =
  | { ok: true; resource: Resource; filePath: string }
  | { ok: false; error: string; blockReason?: BlockReason; retryable: boolean };

// ports
interface DownloaderPort {
  getInfo(url: string): Promise<{ entries: Resource[] } | Resource>;
  download(url: string): Promise<DownloadResult>;
}

interface NotifierPort {
  notify(jobId: number, result: DownloadResult): Promise<void>;
  notifyPlaylistQueued(jobId: number, summary: { queued: number; cached: number }): Promise<void>;
}

// Найти/сохранить ресурс в конкретном backend'е. Не Repository — save() делегирует
// внешнему механизму хранения, а не просто пишет CRUD-запись (см. секцию ниже). Может
// быть несколько реализаций одновременно.
interface ResourceStorePort {
  readonly name: string;
  find(resourceId: string): Promise<Resource | null>;
  save(resource: Resource, filePath: string): Promise<void>;
}

// Раздать уже сохранённый ресурс пользователю. Не обобщается на произвольный store —
// см. секцию ниже. opaque jobId, НЕ chatId/messageId — реализация сама резолвит адрес.
interface DeliveryPort {
  deliver(resource: Resource, jobId: number): Promise<void>;
}

// Стор, который умеет и хранить, и раздавать. application получает такие сторы
// отдельным списком `caches`, сторы только для хранения — списком `archives`.
interface ResourceCachePort extends ResourceStorePort, DeliveryPort {}

// repositories
interface QueueRepository {
  enqueue(item: Pick<QueueItem, "url" | "userId"> & Partial<Pick<QueueItem, "resourceId">>): Promise<number>;
  findPendingByUrl(url: string): Promise<QueueItem | null>;
  findPendingByResourceId(resourceId: string): Promise<QueueItem | null>;
  claim(): Promise<QueueItem | null>;
  updateStatus(id: number, status: QueueStatus, patch?: Partial<QueueItem>): Promise<void>;
  requeueByBlockReason(reason: BlockReason, newStatus: QueueStatus, staggerSeconds?: number): Promise<void>;
  countByStatusForUser(userId: number): Promise<Record<string, number>>;
  findStuckProcessing(): Promise<QueueItem[]>;
}

interface ResourceRepository {
  findByResourceId(resourceId: string): Promise<Resource | null>;
  save(resource: Resource): Promise<void>;
}

interface ErrorLogRepository {
  add(jobId: number, url: string, error: string): Promise<void>;
}
```

### `ResourceCachePort` — почему порт, а не репозиторий

`*Repository` (`QueueRepository`, `ResourceRepository`) — технология-агностичное хранение
доменных данных (CRUD по ключу, неважно sqlite это или postgres). `*Port`
(`DownloaderPort`, `NotifierPort`, `ResourceStorePort`/`ResourceCachePort`) — пересечение
границы с внешней системой, где происходит больше, чем «сохранить/прочитать» (скачать
файл процессом, отправить сообщение, раздать файл через канал доставки). `save()` раздаёт
файл через конкретный механизм (Telegram-канал), а не просто хранит метаданные — поэтому
Port, не Repository. Реализация (`infra/telegram/channel-cache`) может внутри себя
называться как угодно, хоть `TelegramChannelRepo` — на имя порта в domain это не влияет,
там имя остаётся технологически нейтральным.

### `ResourceStorePort` vs `ResourceCachePort` — почему `deliver` не в общем порту

Обнаружено в сессии 2026-08-24 при проектировании fs-адаптера для `CONTENT_DIR` (сейчас
эта логика — инлайновый `fs`-код прямо в `application/process-download-job.ts`, находка
аудита, см. `docs/diary/2026-08-23_infra-restructure-plan.md`, секция «Ревизия —
2026-08-24»). Идея — сделать fs-версию `ResourceCachePort`, чтобы application фанаутил
`find`/`save` по массиву реализаций вместо инлайнового кода.

`deliver(track, jobId)` в эту идею **не укладывается**: она физически завязана на
Telegram-специфичные данные (`telegram_track_refs`/`channelId` для `forwardMessage`), к
которым у fs-стора нет и не может быть доступа — «доставка» локального файла
пользователю всё равно идёт через Telegram, не через сам fs. Обобщать `deliver` на
произвольный store — фиктивная абстракция (no-op или заглушка на не-telegram
реализациях).

Поэтому порт расслоён:
- `ResourceStorePort` (`find`/`save`) — generic, может быть несколько реализаций одновременно.
- `DeliveryPort` (`deliver`) — отдельный контракт, telegram-специфичный по смыслу.
- `ResourceCachePort extends ResourceStorePort, DeliveryPort` — стор, который умеет и хранить, и
  раздавать (сейчас — только telegram-канал).

Application получает сторы двумя **типизированными** списками: `caches: ResourceCachePort[]`
(источник cache-hit и доставки) и `archives: ResourceStorePort[]` (только `save`, например fs);
раскладывает их `main.ts`. `deliver()` нельзя отделить от стора, где `find()` нашёл трек, —
поэтому не отдельный параметр `DeliveryPort`, а отдельный список сторов.

> Пересмотрено 2026-09-20: раньше `stores` был одним массивом, а сторы с `deliver`
> определялись duck-typing'ом (`isTrackCachePort`, `typeof store.deliver === "function"`).
> Минус — неявный контракт: стор без `deliver` молча выпадал из доставки, компилятор не
> ловил. Порядок save→deliver для telegram и затем save для fs остался прежним.

Реализовано (не только спроектировано) — `fs-cache-adapter.ts` (`ResourceStorePort`,
сохраняет в `content/{mp3,mp4}/{sanitizeTitle(title)}_{resourceId}.{ext}` — человекочитаемое
имя + resourceId в суффиксе; `find()` сканирует директорию через `readdir` и матчит по
суффиксу `_{resourceId}.{ext}`, без отдельного индекса path-по-track_id) вынес прежний
инлайновый `fs`-код из `application/process-download-job.ts`. Cache-hit-проверка в
application — `findDeliverable(resourceId)`: чистый lookup (не отправляет ничего сам),
вызывающий код явным отдельным вызовом делает `store.deliver(track, jobId)`.
`telegram-channel-cache.ts` не менялся по сути — как реализовывал все три метода, так и
реализовывает; один объект просто удовлетворяет обоим интерфейсам (TS structural typing).
Единственная правка в самой реализации — `find()` там стал сначала проверять
`telegram_track_refs` (backend-proof), а не сразу общую `resource`-таблицу, — иначе с
появлением второго писателя в `resource` (fs-стор) `find()` мог бы соврать "есть в
канале" для трека, закэшированного только на диске, и `deliver()` падал бы. Подробности —
`docs/diary/2026-08-23_infra-restructure-plan.md`, секция «Ревизия — 2026-08-24».

Известное ограничение (открыто в бэклоге): cache-hit-проверка в application смотрит
только на сторы с `deliver` — fs-only хит (`CACHE_TO_CHANNEL=false`) не переиспользуется,
трек скачается заново, т.к. fs-стор физически не может сам раздать файл пользователю.

`deliver(track, jobId)` берёт **opaque `jobId`**, а не `chatId`/`messageId` — иначе
telegram-специфичные данные протекли бы в сигнатуру domain-порта. Реализация сама
резолвит адрес через lookup в `telegram_reply_refs` по `jobId`, точно так же, как уже
делает реализация `NotifierPort`.

Заодно замечено пересечение ответственности: `NotifierPort.notify()` и
`ResourceCachePort.deliver()` оба резолвят `jobId → chatId` через `telegram_reply_refs` и оба
шлют что-то пользователю через Telegram Bot API — но не полный дубль (`notify` шлёт
свежескачанные байты через `sendMedia`, `deliver` форвардит уже существующее сообщение из
канала через `forwardMessage`). Решено **не трогать** — см. диари, там же открытый вопрос
про fs-only cache-hit (нет `deliver`, нужен будет fallback через `NotifierPort`).

### `blockReason` — enum в domain

`queue.status` остаётся строго generic (`pending | processing | done | failed`) — никаких
специфичных для источника значений вроде `geo_blocked`. Причина, по которой задача остановлена
навсегда, — `BlockReason` (`geo | drm | too_large | crashed_repeatedly`), enum в
`domain/block-reason.ts`. Значения в БД — те же строки, что и раньше (`queue.block_reason`).

> Пересмотрено 2026-09-20: раньше `blockReason` был `string | null`, который
> domain/application «не интерпретируют», а значение придумывал `infra/downloader/yt-dlp`
> (см. диари, «geo_blocked не должен быть литералом в generic queue.status»). Опечатки в
> строках не ловились компилятором, а application всё равно сам писал `"too_large"` и
> `"crashed_repeatedly"`. Общий enum убрал это; `queue.status` от этого не стал
> специфичным — причина по-прежнему отдельное поле.

Читая значение из БД, репозиторий приводит строку через `parseBlockReason` (неизвестное → `null`).
Пользовательский текст на каждую причину — `Record<BlockReason, …>` в `telegram-notifier`
(добавление причины без текста не компилируется).

## `infra/telegram/types.ts`

Приватные для telegram-слоя. `domain`/`application` про них не знают и знать не должны.

```ts
// Единственный тип адреса для ответа юзеру — используется и presentation-хендлерами
// (handle-message, listen-channel), и реализацией NotifierPort/ResourceCachePort. Отдельного
// типа "ReplyTarget" не заводим — это была бы та же структура под другим именем.
type TelegramReplyRef = {
  jobId: number;
  chatId: number;
  messageId: number;
};

// track_id → где лежит уже закэшированный файл в канале. Backing store для ResourceCachePort.
type TelegramTrackRef = {
  resourceId: string;
  channelMessageId: number;
};

type TelegramSendQueueItem = {
  id: number;
  jobId: number;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  retryAfter: number | null;
  error: string | null;
};
```

Все три таблицы (`telegram_reply_refs`, `telegram_track_refs`, `telegram_send_queue`)
живут в отдельной физической БД `data/telegram.db` — подробности и обоснование в диари,
секция «две физические SQLite-БД вместо одной».

## Остаток работы

- [ ] Перенести эти объявления в реальный код (`src/domain/types.ts`,
      `src/infra/telegram/types.ts`) при рефакторинге каталогов
- [ ] `QueueRepository`/`ResourceRepository`/`DownloaderPort`/`NotifierPort`/`ResourceCachePort` —
      только сигнатуры, реализации ещё не начаты
- [ ] `telegram_send_queue` — таблица и `infra/telegram/workers/send-queue-poller.ts`
      спроектированы, не реализованы (см. диари)
- [ ] `telegram_track_refs` — новая таблица, нужна миграция при рефакторинге: сейчас
      `channel_message_id` живёт прямо в generic `tracks` (см. диари, секция аудита
      архитектуры — находка №1)
