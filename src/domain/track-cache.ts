import type { Track } from "./resource";

// Найти/сохранить трек в конкретном backend'е кэша. Не Repository — save() делегирует
// внешнему механизму хранения (аплоад в канал, копирование на диск), а не просто пишет
// CRUD-запись. Может быть несколько реализаций одновременно (application держит массив
// TrackStorePort[] и фанаутит find/save по всем) — см. docs/diary/2026-08-23_infra-restructure-plan.md,
// секция "Ревизия — 2026-08-24".
export interface TrackStorePort {
  find(trackId: string): Promise<Track | null>;
  save(track: Track, filePath: string): Promise<void>;
}

// TrackStorePort, который вдобавок умеет раздать уже сохранённый трек пользователю через
// свой backend. deliver() принципиально НЕ обобщается на произвольный store (например fs
// не может "доставить" файл — доставка всё равно идёт через Telegram) — поэтому это не
// собственный домен-порт, а расширение конкретного (telegram) стора. В TrackStorePort[]
// определяется через duck-typing (isTrackCachePort ниже) — application перебирает массив
// и зовёт deliver() у тех сторов, которые его реализуют.
export interface TrackCachePort extends TrackStorePort {
  // opaque jobId, НЕ chatId/messageId — реализация сама резолвит адрес доставки.
  deliver(track: Track, jobId: number): Promise<void>;
}

export function isTrackCachePort(store: TrackStorePort): store is TrackCachePort {
  return typeof (store as Partial<TrackCachePort>).deliver === "function";
}
