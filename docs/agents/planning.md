# Planning: Telegram Music Bot

## Цель

Telegram-бот для скачивания музыки через yt-dlp с кэшированием через приватный Telegram-канал.

## Архитектура

```
User → Bot (link/playlist)
           ↓
       SQLite queue
           ↓
       Worker (yt-dlp)
           ↓
       Post audio → Channel (сохранить message_id)
           ↓
       Bot forward → User

Повторный запрос → Bot forward из Channel (без скачивания)
```

## Стек

- **Runtime**: Bun
- **Language**: TypeScript
- **DB**: SQLite via `bun:sqlite` (встроенный)
- **Bot**: Telegraf
- **Downloader**: yt-dlp через `Bun.spawn`
- **Формат**: нативный (opus/m4a/best — без конвертации)

## SQLite схема

```sql
-- Очередь заданий
CREATE TABLE queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,
  track_id    TEXT,               -- yt-dlp extractor ID (null до разворачивания)
  user_id     INTEGER NOT NULL,
  status      TEXT DEFAULT 'pending', -- pending | processing | done | failed
  error       TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);

-- Кэш скачанных треков
CREATE TABLE tracks (
  track_id           TEXT PRIMARY KEY,  -- yt-dlp ID (extractor + id)
  url                TEXT NOT NULL,
  channel_message_id INTEGER NOT NULL,
  title              TEXT,
  duration           INTEGER,
  cached_at          INTEGER DEFAULT (unixepoch())
);

-- Пользователи
CREATE TABLE users (
  user_id    INTEGER PRIMARY KEY,
  username   TEXT,
  first_seen INTEGER DEFAULT (unixepoch())
);
```

## Структура проекта

```
src/
├── bot/
│   ├── index.ts          # Telegraf setup, старт polling
│   └── handlers.ts       # onText → валидация URL → очередь или forward
├── worker/
│   ├── index.ts          # setInterval loop, берёт pending из queue
│   └── downloader.ts     # Bun.spawn yt-dlp, парсинг JSON метадаты
├── db/
│   ├── index.ts          # Database singleton (bun:sqlite)
│   └── schema.ts         # CREATE TABLE IF NOT EXISTS
├── config.ts             # process.env валидация
└── main.ts               # запуск bot + worker в одном процессе
.env.example
package.json
tsconfig.json
```

## Env переменные

```env
BOT_TOKEN=       # Telegram bot token
CHANNEL_ID=      # ID приватного канала (например -1001234567890)
PROXY=           # опционально: socks5://localhost:9090
```

## Логика воркера

### Плейлист/трек — алгоритм

```
1. Взять задание со статусом pending
2. Запустить: yt-dlp --flat-playlist -J <url>
3. Если entries[] → развернуть каждый трек в отдельную queue запись (status=pending, track_id заполнен)
4. Если один трек → проверить tracks по track_id
   a. Есть в кэше → forward channel_message_id пользователю, статус done
   b. Нет → скачать, загрузить в канал, сохранить в tracks, forward пользователю
5. Статус задания → done / failed
```

### yt-dlp аргументы для скачивания

```bash
yt-dlp \
  --no-playlist \           # один трек за раз
  -f bestaudio \
  --print-json \            # метадата в stdout
  [--proxy socks5://...] \  # если PROXY задан
  -o /tmp/ytdlp/%(id)s.%(ext)s \
  <url>
```

## Задачи по приоритету

### P0 — Ядро (без этого ничего не работает)

- [ ] **1. Инициализация проекта**
  - `bun init`, `tsconfig.json`, `package.json`
  - Зависимости: `telegraf`
  - `.env.example`

- [ ] **2. DB: schema + connection**
  - `src/db/index.ts` — singleton `bun:sqlite`
  - `src/db/schema.ts` — CREATE TABLE queue, tracks, users

- [ ] **3. Config**
  - `src/config.ts` — читать env, падать если обязательные не заданы

- [ ] **4. Bot: приём ссылок**
  - `src/bot/handlers.ts` — onText с URL
  - Регистрация пользователя в users
  - Проверка кэша tracks → если есть, forward
  - Если нет → добавить в queue, ответить "добавлено в очередь"

- [ ] **5. Worker: базовый loop**
  - `src/worker/index.ts` — setInterval каждые 5 сек
  - Берёт одно pending задание, ставит status=processing

- [ ] **6. Downloader: yt-dlp интеграция**
  - `src/worker/downloader.ts`
  - `getInfo(url)` — `--flat-playlist -J` → возвращает entries или одиночный трек
  - `download(url, trackId)` — скачивает трек, возвращает путь к файлу + метадату

- [ ] **7. Worker: полный цикл**
  - Разворачивание плейлиста → под-задания в queue
  - Скачивание трека
  - Отправка в канал через Telegraf
  - Сохранение в tracks
  - Forward пользователю
  - Удаление временного файла

- [ ] **8. main.ts**
  - Запуск bot.launch() + worker loop параллельно

### P1 — Важно, но после ядра

- [ ] **9. Обработка ошибок**
  - status=failed + сохранение error в queue
  - Уведомление пользователя об ошибке
  - Retry логика (max 3 попытки)

- [ ] **10. Уведомления о прогрессе**
  - "Трек 3/12 из плейлиста загружен"
  - Редактирование одного сообщения вместо спама

- [ ] **11. Дедупликация в очереди**
  - Не добавлять URL если уже есть pending/processing с тем же track_id

### P2 — Улучшения

- [ ] **12. Команды бота**
  - `/status` — что сейчас в очереди
  - `/cancel` — отмена своих заданий

- [ ] **13. Очистка временных файлов**
  - Гарантированное удаление даже при ошибке (try/finally)

- [ ] **14. Логирование**
  - Структурированные логи с timestamp

## Решения

- Формат: аудио → mp3 (best quality), видео → mp4. Требует ffmpeg на сервере
- Лимит Telegram 50MB — треки превышающие лимит пропускаются, пользователь получает уведомление с названием трека
- Telegram sendAudio / sendVideo — используем для встроенного плеера в чате

## Хостинг / инфраструктура

- [ ] Перенести бота на домашний Raspberry Pi 3B+ + k3s (учебная цель заодно). DietPi прошита и поднята (`192.168.0.118`, hostname `DietPi`, SSH по ключу). Обе флешки размечены и смонтированы: `/mnt/apps` (29GB, ext4, под k3s `--data-dir`), `/mnt/storage` (7.6GB, ext4, под медиа/downloads бота). Новый БП (5V/2.4A) подключён 2026-08-21 — проверено под нагрузкой (параллельная запись 500MB на обе флешки + CPU ~75 сек): `vcgencmd get_throttled` стабильно `0x80000` (только исторический флаг soft temp limit, без undervoltage), voltage 1.28V, ни одного отвала устройств. **Блокер по питанию снят.** Подключение упрощено — `ssh pi` (mDNS-алиас `DietPi.local` в `~/.ssh/config.d/personal.conf`, переживает смену IP по DHCP; `avahi-daemon` доставлен на Pi). Инструменты выбраны: **k3s** (не microk8s — snap лишний на DietPi), **Flux** (не ArgoCD — легче по ресурсам). Осталось: сам k3s (`INSTALL_K3S_EXEC="--data-dir=/mnt/apps"`), деплой бота (образ уже в `ghcr.io/iwwwanow/iwwwanow_kanalveshchaniya`, arm64). Подробности, история дебага обнаружения Pi в сети, разбор бюджета питания — `docs/diary/2026-08-19_raspberry-pi-hosting.md`
- [x] `CACHE_TO_CHANNEL` / `SAVE_TO_CONTENT_DIR` — независимая опциональность обоих способов сохранения медиа, с валидацией «хотя бы один обязателен» — см. дневник выше
