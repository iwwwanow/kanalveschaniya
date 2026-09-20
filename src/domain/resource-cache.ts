import type { Resource } from "./resource";

// Найти/сохранить трек в конкретном backend'е кэша. Не Repository — save() делегирует
// внешнему механизму хранения (аплоад в канал, копирование на диск), а не просто пишет
// CRUD-запись. Может быть несколько реализаций одновременно (application держит массив
// ResourceStorePort[] и фанаутит find/save по всем) — см. docs/diary/2026-08-23_infra-restructure-plan.md,
// секция "Ревизия — 2026-08-24".
export interface ResourceStorePort {
  // Короткое имя бэкенда для логов (какой именно стор сохраняет/падает) — см.
  // download-job.ts / deliver-job.ts, где каждый save()/deliver() логируется отдельно.
  readonly name: string;
  find(resourceId: string): Promise<Resource | null>;
  // jobId — opaque, как у deliver: даёт реализации контекст запроса (например Telegram-кэш
  // прикладывает к файлу исходное сообщение пользователя); большинству сторов не нужен.
  save(resource: Resource, filePath: string, jobId: number): Promise<void>;
}

// Раздать уже сохранённый трек пользователю через backend, где он лежит. Не обобщается на
// произвольный store (fs не может "доставить" файл — доставка всё равно идёт через
// Telegram), поэтому это отдельный контракт, а не часть ResourceStorePort.
// opaque jobId, НЕ chatId/messageId — реализация сама резолвит адрес доставки.
export interface DeliveryPort {
  deliver(resource: Resource, jobId: number): Promise<void>;
}

// Архив, который умеет отдать сохранённый файл обратно (fs). Дедуп по нему: при повторном
// запросе ресурс не скачивается заново, а уходит пользователю из архива (сам файл — путь
// на диске, доставка идёт через NotifierPort). Файл архива приложение не удаляет.
export interface ResourceArchivePort extends ResourceStorePort {
  findFile(resourceId: string): Promise<{ resource: Resource; filePath: string } | null>;
}

// Стор, который умеет и хранить, и раздавать. deliver() надо звать у того же стора, где
// find() нашёл трек — поэтому application получает такие сторы отдельным списком (caches),
// а не угадывает по форме объекта в общем массиве (см. docs/specs/types.md).
export interface ResourceCachePort extends ResourceStorePort, DeliveryPort {}
