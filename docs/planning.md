- ты ошибся в том, что в директории telegram-bot у тебя есть модуль domain. это в корне неверно. приложение твое - канал вещания. он не должен быть привязан к вендору

- [ ] запускайся и собирайся на ноде. не еби мозги
  - [ ] workspaces
  - [ ] typescript
  - [ ] eslint
  - [ ] esbuild

- [x] разбираюсь с drizzle. не запускается через bunjs. через npx вроде работает

---

- [ ] download adapter
- cron on processors on adapters or infra?
- repositories on infra
- composition root on infra
- config on infra/composition root/ entrypoint

---

- [ ] инфра и адаптеры
  - для начала выясни что это такое. границы их возможностей

---

- [x] остановился на рефакторинге QueueTask

---

- [ ] application, use-cases
  - для начала пойми, какие юс-кейсы вообще нужны
  - [ ] download-use-case
    - нужно теперь написать юс-кейс для скачивания
    - обрати внимание, что сслышки будут браться из очереди, и отправляться на третий сервис
    - как будет выглядеть этот адаптер для третьего сервиса?
    - там по сути будет только фетч на третий сервис и все.
    - вопрос в том, как он будет реализовываться на уровне application
    -
    - мне не нравится то, что интерфейс для адапрета определяется в application/interface.
    - при том, что похожий функционал определяется в dtos
    - может быть можно подобрать более подходящий, более спецефичный нейминг для adapter-interfaces?
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
