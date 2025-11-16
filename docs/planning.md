- ты ошибся в том, что в директории telegram-bot у тебя есть модуль domain. это в корне неверно. приложение твое - канал вещания. он не должен быть привязан к вендору

---

- [ ] application, use-cases
  - для начала пойми, какие юс-кейсы вообще нужны
- [ ] domain, unit-tests
- [ ] application, unit-tests
- [ ] application, integration-tests

---

- [x] formatting
- [ ] linting
- [ ] typecheck

- [ ] нужна команда download. лучше даже не команду, просто обработка вообще всех сообщений как ссылок

- cobalt deepwiki - https://deepwiki.com/imputnet/cobalt
- sc cobalt code - https://github.com/imputnet/cobalt/blob/47d8ccbc17aeeac6cb754c8b721c2148f007c103/api/src/processing/services/soundcloud.js#L11

```
Конкретная цепочка вызовов:
bot/application/use-cases/handle-command.use-case.ts
Получает команду /download от presentation слоя
Вызывает shared/application/use-cases/download-track.use-case.ts

shared/application/download-track.use-case.ts
Проверяет кэш через TrackRepository (domain слой)
Если трека нет в кэше → вызывает packages/downloader

packages/downloader
Это infrastructure-пакет, который знает КАК скачивать
Использует внешние библиотеки (yt-dlp, axios и т.д.)
Возвращает результат скачивания (файл, метаданные)
Возврат по цепочке:
downloader → shared/application → bot/application → bot/presentation
```

---

- bunjs
- sqlite db (drizzle orm)
  - нужна очередь на скачивание
  - нужна для того, чтобы не скачивать уже скачанные треки, а брать их из кэша
- ddd + (clean)

### mvp use-cases:

- download track by url
  - check track by url in DB
    - if has it - send it
    - if not has it - download it and write data into db
  - post it to channel

### use-cases:

- download likes
- download playlist
