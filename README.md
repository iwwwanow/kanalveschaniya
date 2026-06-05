# kanalveshchaniya

![logo](assets/logo/renders/logo.png)

Telegram-бот для скачивания музыки и видео через yt-dlp с кэшированием через приватный Telegram-канал.

## Как работает

1. Отправляешь боту ссылку на трек или плейлист
2. Бот скачивает через yt-dlp и публикует в приватный канал
3. Пересылает тебе из канала
4. При повторном запросе той же ссылки — мгновенно пересылает из канала без повторного скачивания

Поддерживаются все источники, которые поддерживает yt-dlp: SoundCloud, YouTube, Bandcamp и др.

## Требования

- [Bun](https://bun.sh)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org) — для конвертации в mp3/mp4

## Установка

```bash
bun install
cp .env.example .env
# заполни .env
bun run dev
```

## Переменные окружения

| Переменная | Обязательная | Описание |
|-----------|:---:|---------|
| `BOT_TOKEN` | да | Токен бота от [@BotFather](https://t.me/BotFather) |
| `CHANNEL_ID` | да | ID приватного канала для хранения треков (например `-1001234567890`). Бот должен быть администратором канала |
| `PROXY` | нет | SOCKS5 прокси для обхода гео-блокировок (например `socks5://localhost:9090`). При наличии прокси все гео-заблокированные треки автоматически встают в очередь на повтор при старте |
| `WORKER_CONCURRENCY` | нет | Количество параллельных воркеров (по умолчанию `3`) |
| `TMP_DIR` | нет | Директория для временных файлов во время скачивания (по умолчанию `/tmp/ytdlp`) |

### Как получить CHANNEL_ID

Перешли любое сообщение из канала боту [@userinfobot](https://t.me/userinfobot) — он вернёт ID.

## Команды бота

| Команда | Описание |
|---------|---------|
| `/start` | Приветствие |
| `/status` | Статус очереди |

## Docker

```bash
docker run -d \
  -e BOT_TOKEN=... \
  -e CHANNEL_ID=... \
  -v ./data:/app/data \
  ghcr.io/iwwwanow/iwwwanow_kanalveshchaniya:latest
```

## CI/CD

Push в `master` → semantic-release → Docker image в `ghcr.io`.

Версионирование через [conventional commits](https://www.conventionalcommits.org).
