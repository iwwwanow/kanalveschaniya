# Todo List

## В работе

## Backlog

- [ ] Подробный логгинг — timestamp, уровни (info/warn/error), контекст (job id, user id, url)

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
