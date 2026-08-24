# Типы — domain и infra/telegram

Черновик типов (код, но без логики) для clean-архитектуры (`domain`/`application`/`infra`,
см. `docs/diagram.d2` и `docs/diary/2026-08-22_clean-architecture-refactor.md`). Пока
только спецификация — при рефакторинге каталогов переносится как есть в
`src/domain/types.ts` и `src/infra/telegram/types.ts`.

## `domain/types.ts`

Знает про них весь `application` (use-cases) и все `infra`-адаптеры, реализующие
domain-порты. Никакой telegram- или yt-dlp-специфики здесь быть не должно.

```ts
// interfaces
type Track = {
  trackId: string;
  url: string;
  title: string;
  duration: number;
};

type QueueItem = {
  id: number;
  url: string;
  trackId: string | null; // null до разворачивания плейлиста
  userId: number;
  status: "pending" | "processing" | "done" | "failed";
  error: string | null;
  blockReason: string | null; // opaque для domain/application, см. секцию ниже
  createdAt: number;
};

type DownloadResult =
  | { ok: true; track: Track; filePath: string }
  | { ok: false; error: string; blockReason?: string; retryable: boolean };

// ports
interface DownloaderPort {
  getInfo(url: string): Promise<{ entries: Track[] } | Track>;
  download(url: string): Promise<DownloadResult>;
}

interface NotifierPort {
  notify(jobId: number, result: DownloadResult): Promise<void>;
}

// Найти/сохранить трек в конкретном backend'е кэша. Не Repository — save() делегирует
// внешнему механизму хранения, а не просто пишет CRUD-запись (см. секцию ниже). Может
// быть несколько реализаций одновременно — application фанаутит find/save по массиву.
interface TrackStorePort {
  find(trackId: string): Promise<Track | null>;
  save(track: Track, filePath: string): Promise<void>;
}

// TrackStorePort, который вдобавок умеет раздать уже сохранённый трек пользователю через
// свой backend. Используется как единственный экземпляр (НЕ через TrackStorePort[]-массив) —
// deliver принципиально не обобщается на произвольный store, см. секцию ниже.
interface TrackCachePort extends TrackStorePort {
  deliver(track: Track, jobId: number): Promise<void>; // opaque jobId, НЕ chatId/messageId —
                                                          // реализация сама резолвит адрес,
                                                          // как это уже делает NotifierPort
}

interface QueueRepository {
  enqueue(item: Pick<QueueItem, "url" | "userId">): Promise<number>;
  claim(): Promise<QueueItem | null>;
  updateStatus(id: number, status: QueueItem["status"], patch?: Partial<QueueItem>): Promise<void>;
  requeueByBlockReason(reason: string, newStatus: QueueItem["status"]): Promise<void>;
}

interface ResourceRepository {
  findByTrackId(trackId: string): Promise<Track | null>;
  save(track: Track): Promise<void>;
}
```

### `TrackCachePort` — почему порт, а не репозиторий

`*Repository` (`QueueRepository`, `ResourceRepository`) — технология-агностичное хранение
доменных данных (CRUD по ключу, неважно sqlite это или postgres). `*Port`
(`DownloaderPort`, `NotifierPort`, `TrackStorePort`/`TrackCachePort`) — пересечение
границы с внешней системой, где происходит больше, чем «сохранить/прочитать» (скачать
файл процессом, отправить сообщение, раздать файл через канал доставки). `save()` раздаёт
файл через конкретный механизм (Telegram-канал), а не просто хранит метаданные — поэтому
Port, не Repository. Реализация (`infra/telegram/channel-cache`) может внутри себя
называться как угодно, хоть `TelegramChannelRepo` — на имя порта в domain это не влияет,
там имя остаётся технологически нейтральным.

### `TrackStorePort` vs `TrackCachePort` — почему `deliver` не в общем порту

Обнаружено в сессии 2026-08-24 при проектировании fs-адаптера для `CONTENT_DIR` (сейчас
эта логика — инлайновый `fs`-код прямо в `application/process-download-job.ts`, находка
аудита, см. `docs/diary/2026-08-23_infra-restructure-plan.md`, секция «Ревизия —
2026-08-24»). Идея — сделать fs-версию `TrackCachePort`, чтобы application фанаутил
`find`/`save` по массиву реализаций вместо инлайнового кода.

`deliver(track, jobId)` в эту идею **не укладывается**: она физически завязана на
Telegram-специфичные данные (`telegram_track_refs`/`channelId` для `forwardMessage`), к
которым у fs-стора нет и не может быть доступа — «доставка» локального файла
пользователю всё равно идёт через Telegram, не через сам fs. Обобщать `deliver` на
произвольный store — фиктивная абстракция (no-op или заглушка на не-telegram
реализациях).

Поэтому порт расслоён на два:
- `TrackStorePort` (`find`/`save`) — generic, может быть несколько реализаций
  одновременно (`stores: TrackStorePort[]`, fan-out).
- `TrackCachePort extends TrackStorePort` добавляет `deliver` — остаётся
  telegram-специфичным. В массиве `stores` определяется через duck-typing
  (`isTrackCachePort(store): store is TrackCachePort`, проверка `typeof store.deliver ===
  "function"`) — application перебирает `stores` и зовёт `deliver()` у тех, кто его
  реализует, вместо отдельного поля/массива под "доставляемые" сторы.

Реализовано (не только спроектировано) — `fs-cache-adapter.ts` (`TrackStorePort`,
сохраняет в `content/{mp3,mp4}/{sanitizeTitle(title)}_{trackId}.{ext}` — человекочитаемое
имя + trackId в суффиксе; `find()` сканирует директорию через `readdir` и матчит по
суффиксу `_{trackId}.{ext}`, без отдельного индекса path-по-track_id) вынес прежний
инлайновый `fs`-код из `application/process-download-job.ts`. Cache-hit-проверка в
application — `findDeliverable(trackId)`: чистый lookup (не отправляет ничего сам),
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
`TrackCachePort.deliver()` оба резолвят `jobId → chatId` через `telegram_reply_refs` и оба
шлют что-то пользователю через Telegram Bot API — но не полный дубль (`notify` шлёт
свежескачанные байты через `sendMedia`, `deliver` форвардит уже существующее сообщение из
канала через `forwardMessage`). Решено **не трогать** — см. диари, там же открытый вопрос
про fs-only cache-hit (нет `deliver`, нужен будет fallback через `NotifierPort`).

### `blockReason` — opaque-поле

`queue.status` остаётся строго generic (`pending | processing | done | failed`) —
никаких специфичных для источника значений вроде `geo_blocked`. Причина блокировки —
`blockReason: string | null`, который domain/application **не интерпретируют**, только
хранят и передают. Значение (например `'geo'`) придумывает и присваивает
`infra/downloader/yt-dlp`. Подробное обоснование — диари, секция
«geo_blocked не должен быть литералом в generic queue.status».

## `infra/telegram/types.ts`

Приватные для telegram-слоя. `domain`/`application` про них не знают и знать не должны.

```ts
// Единственный тип адреса для ответа юзеру — используется и presentation-хендлерами
// (handle-message, listen-channel), и реализацией NotifierPort/TrackCachePort. Отдельного
// типа "ReplyTarget" не заводим — это была бы та же структура под другим именем.
type TelegramReplyRef = {
  jobId: number;
  chatId: number;
  messageId: number;
};

// track_id → где лежит уже закэшированный файл в канале. Backing store для TrackCachePort.
type TelegramTrackRef = {
  trackId: string;
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
- [ ] `QueueRepository`/`ResourceRepository`/`DownloaderPort`/`NotifierPort`/`TrackCachePort` —
      только сигнатуры, реализации ещё не начаты
- [ ] `telegram_send_queue` — таблица и `infra/telegram/workers/send-queue-poller.ts`
      спроектированы, не реализованы (см. диари)
- [ ] `telegram_track_refs` — новая таблица, нужна миграция при рефакторинге: сейчас
      `channel_message_id` живёт прямо в generic `tracks` (см. диари, секция аудита
      архитектуры — находка №1)
