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

// Раздача уже скачанного трека из кэша. Не Repository — это не просто CRUD
// доменных данных, а делегирование внешнему механизму доставки (см. секцию ниже).
interface TrackCachePort {
  find(trackId: string): Promise<Track | null>;
  save(track: Track, filePath: string): Promise<void>;
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
(`DownloaderPort`, `NotifierPort`, `TrackCachePort`) — пересечение границы с внешней
системой, где происходит больше, чем «сохранить/прочитать» (скачать файл процессом,
отправить сообщение, раздать файл через канал доставки). `TrackCachePort` раздаёt файл
через конкретный механизм (Telegram-канал), а не просто хранит метаданные — поэтому Port,
не Repository. Реализация (`infra/telegram/channel-cache`) может внутри себя называться
как угодно, хоть `TelegramChannelRepo` — на имя порта в domain это не влияет, там имя
остаётся технологически нейтральным.

`deliver(track, jobId)` берёт **opaque `jobId`**, а не `chatId`/`messageId` — иначе
telegram-специфичные данные протекли бы в сигнатуру domain-порта. Реализация сама
резолвит адрес через lookup в `telegram_reply_refs` по `jobId`, точно так же, как уже
делает реализация `NotifierPort`.

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
