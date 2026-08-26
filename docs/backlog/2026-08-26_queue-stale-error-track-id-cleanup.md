# Почистить мусор в queue: stale error, непубликуемый track_id

Найдено в сессии 2026-08-24 при сверке по БД после успешного ретрая job 1 (Ruchey):

- `updateStatus(id, "done")` в `process-download-job.ts` вызывается без `patch` — поле `queue.error` не чистится и остаётся текстом ошибки от предыдущей (упавшей) попытки, даже когда job в итоге дошёл до `done`. Не user-facing (`/status` отдаёт только счётчики по статусам, не читает `error`), но вводит в заблуждение при прямом чтении БД.
- `queue.track_id` у job 1 в БД — `NULL`, хотя трек успешно закэширован (`resource`/`telegram_track_refs` заполнены). `runJob` резолвит `trackId` через `downloader.getInfo(url)` в локальную переменную и никогда не пишет его обратно в `queue` (`updateStatus` в `queue-repository.ts` вообще не принимает `trackId` в патче). На каждом ретрае того же job'а `getInfo()` дергается заново — лишний (хоть и дешёвый, metadata-only) вызов yt-dlp вместо переиспользования уже известного `trackId`.

Fix — при успешном `done` явно чистить `error`/`block_reason` (`patch: { error: null, blockReason: null }`); при первом резолве `trackId` — сразу писать его в `queue.track_id` (добавить `trackId` в `Partial<QueueItem>` для `updateStatus`, звать сразу после `getInfo()` в `runJob`).

Важно: это НЕ причина повторного полного скачивания трека при ретрае (см. "Разделить скачивание и отправку") — та проблема из-за того, что при первом падении ни один стор не успел сохранить трек целиком, `findDeliverable` ищет по `resource`/`telegram_track_refs`, а не по `queue.track_id`. Этот пункт — только про мусор в самой строке `queue` и лишний `getInfo()`-вызов.
