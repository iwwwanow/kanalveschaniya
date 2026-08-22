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

## Рефакторинг архитектуры (clean: domain / application / infra)

- [x] Границы слоёв согласованы, финальная схема — `docs/diagram.d2`
      (infrastructure → application → domain: presentation/telegram-bot,
      adapters/yt-dlp, repository/{telegram,sqlite}, workers/queue-poller;
      use-cases enqueue-download + process-download; domain interfaces/ports/repository)
- [ ] Сам рефакторинг каталогов под `domain/application/infra` — не начат.
      Подробности решений — `docs/diary/2026-08-22_clean-architecture-refactor.md`
- [x] GitHub Actions работоспособны — токен `gh` был протух под неверным аккаунтом
      (`kirill-ivanovvv` вместо `iwwwanow`), починили через `gh auth login`.
      Последний прогон (коммит `3a52e73`) — success. Подробности там же

## Хостинг / инфраструктура

- [ ] Перенести бота на домашний Raspberry Pi 3B+ + k3s (учебная цель заодно). **k3s и Flux подняты и стабильны** (нода `dietpi` Ready, все 4 контроллера Flux Running, zram подключён под нехватку RAM). **GitOps-манифесты и вся дальнейшая работа по кластеру — в отдельном репозитории `infrastructure_pi`** (`git@github.com:iwwwanow/infrastructure_pi.git`), не здесь — см. его собственный дневник `infrastructure_pi/docs/diary/2026-08-21_pi-k3s-flux-setup.md` за подробностями (cgroup-фикс, медленная flash, память/zram) и остатком работы (git-секрет, GitRepository/Kustomization, манифест бота, SOPS, image-automation-controller). Заказана SD-карта побольше (64GB A1) на замену текущей маленькой boot-карты. Подключение — `ssh pi` (mDNS-алиас, `~/.ssh/config.d/personal.conf`). Подробности по железу/сети (питание, разметка флешек, Wi-Fi) — `docs/diary/2026-08-19_raspberry-pi-hosting.md` в этом репозитории.
- [x] `CACHE_TO_CHANNEL` / `SAVE_TO_CONTENT_DIR` — независимая опциональность обоих способов сохранения медиа, с валидацией «хотя бы один обязателен» — см. дневник выше
