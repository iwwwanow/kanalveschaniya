# Todo List

## В работе

## Backlog


## Готово

- [x] Инициализация проекта (bun, telegraf, tsconfig)
- [x] DB schema (queue, tracks, users)
- [x] Config (env vars)
- [x] Bot handlers (onText, /start, /status)
- [x] Worker loop
- [x] Downloader (yt-dlp spawn, getInfo, download)
- [x] Полный цикл: скачивание → канал → forward пользователю
- [x] Плейлист: разворачивание в отдельные треки
- [x] Кэш: повторный запрос → forward из канала
- [x] 50MB лимит — пропуск с уведомлением
- [x] Retry до 3 раз при ошибке
- [x] Фикс: SQLite wrong param count при разворачивании плейлиста
- [x] Фикс: url undefined для entries в flat-playlist
- [x] Подробный логгинг (timestamp, уровни, job id, user id)
- [x] Параллельный пул воркеров (WORKER_CONCURRENCY, default 3)
- [x] Классификация ошибок: 404 → failed сразу, geo → geo_blocked статус
- [x] geo_blocked авто-реqueue при старте если PROXY задан
