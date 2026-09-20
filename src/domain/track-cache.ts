import type { Track } from "./resource";

// Найти/сохранить трек в конкретном backend'е кэша. Не Repository — save() делегирует
// внешнему механизму хранения (аплоад в канал, копирование на диск), а не просто пишет
// CRUD-запись. Может быть несколько реализаций одновременно (application держит массив
// TrackStorePort[] и фанаутит find/save по всем) — см. docs/diary/2026-08-23_infra-restructure-plan.md,
// секция "Ревизия — 2026-08-24".
export interface TrackStorePort {
  // Короткое имя бэкенда для логов (какой именно стор сохраняет/падает) — см.
  // process-download-job.ts, где каждый save()/deliver() логируется отдельно.
  readonly name: string;
  find(trackId: string): Promise<Track | null>;
  save(track: Track, filePath: string): Promise<void>;
}

// Раздать уже сохранённый трек пользователю через backend, где он лежит. Не обобщается на
// произвольный store (fs не может "доставить" файл — доставка всё равно идёт через
// Telegram), поэтому это отдельный контракт, а не часть TrackStorePort.
// opaque jobId, НЕ chatId/messageId — реализация сама резолвит адрес доставки.
export interface DeliveryPort {
  deliver(track: Track, jobId: number): Promise<void>;
}

// Стор, который умеет и хранить, и раздавать. deliver() надо звать у того же стора, где
// find() нашёл трек — поэтому application получает такие сторы отдельным списком (caches),
// а не угадывает по форме объекта в общем массиве (см. docs/specs/types.md).
export interface TrackCachePort extends TrackStorePort, DeliveryPort {}
