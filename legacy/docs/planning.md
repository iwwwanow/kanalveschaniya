# Planning

## Фаза 1 — CI/CD (текущая)

### 1.1 Dockerfile (production)

Multi-stage сборка:

- **builder**: `node:22-alpine` + python/make/g++ (для native modules), pnpm, `tsc`
- **runner**: `node:22-alpine` + `yt-dlp` бинарник, копируем `dist/` + `node_modules`, запуск `node dist/server.js`

Добавить в `package.json`:
- `"build": "tsc"`
- `"start": "node dist/server.js"`

Скорректировать `tsconfig.json`: добавить `outDir: "dist"`, убрать `noEmit`.

### 1.2 GitHub Action

Файл: `.github/workflows/docker.yml`

- Триггер: push в `master` → образ тегируется `:latest`
- Триггер: git tag `v*` → тегируется версией (`v1.0.0`)
- Registry: `ghcr.io/iwwwanow/kanalveschaniya`
- Авторизация через `GITHUB_TOKEN` (встроенный в Actions, ничего настраивать не нужно)

---

## Фаза 2 — Замена Cobalt на yt-dlp

**Что удаляем:** `cobalt` и `gost` сервисы из `docker-compose.yml`, `CobaltAdapter`.

**Что добавляем:** `YtDlpAdapter` — shell-exec вызов `yt-dlp` с флагами:
- `--proxy socks5://...` (прокси пробрасывается через env)
- `--cookies /app/data/cookies.txt` (монтируется как volume)
- `--output /app/data/files/%(id)s.%(ext)s`
- `--no-playlist` / `--yes-playlist` в зависимости от типа URL

`cookies.txt` — монтируется volume, не запекается в образ.

В `resources` схеме добавить колонку `filePath: text` — абсолютный путь к файлу на диске.

---

## Фаза 3 — Telegram UX

Сейчас бот получает URL но ничего не отвечает пользователю после скачивания.

**Нужно:**
1. Хранить `chatId` в `queue` (уже есть задача в backlog)
2. После успешного скачивания — отправить аудиофайл пользователю (`sendAudio`)
3. Если ресурс уже скачан (`AlreadyDownloaded`) — отправить сразу, без очереди
4. Если в очереди (`AlreadyInQueue`) — ответить сообщением с позицией

**Архитектурно:** `ProcessDownloadUseCase` возвращает `filePath` в результате → `CronEntrypoint` вызывает Telegram API для отправки файла.

---

## Фаза 4 — Дополнительные use-cases

- Скачивание плейлиста по URL (`--yes-playlist`)
- Скачивание лайков SoundCloud (команда из planning: `yt-dlp --download-archive archive.txt ...`)

---

## Что не делаем сейчас

- ESLint (пока нет конфига, отложено)
- Unit/integration тесты (после стабилизации архитектуры)
- Race condition protection в очереди
