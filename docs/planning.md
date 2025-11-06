- у downloader отвалились зависимости. я думаю, что легче всего будет подключить этот сервис как сторонний и наладить общение через АПИ. нучжно проверить при помощи курлов, возможно ли это вообще сделать.
  - сервис поддерживается, и у него есть много разных вендоров. это очень удобно.
  - нужно запустить его в докере, пробить курлами, проверить скачивание треков. будет ли это вообще работать.

- [ ] как должен запускаться дебаггер. если при выключении, я не могу его перезапустить. пишет, что порт занят
- [ ] нужно для начала просто скачать один трек. отследи всю чепочку

questions:
- на каком уровне вызывать repository?
- как его реализовывать

- [ ] TODO: почему presentation вызывает application? это все верно?

- [ ] давай сразу копировать код из того сервиса, затем подключать этот функционал. ниже схема есть уже

---

- [ ] prettierrc config
  - [ ] нужно разбивать импорты
  - [ ] нужно запускать автоматически при сохранении
- [ ] esling-config
  - [ ] default eslint config
- [ ] нужна команда download. лучше даже не команду, просто обработка вообще всех сообщений как ссылок
- [ ] рефакторю энтрипоинт. нужно вынести интерфейсы и bot-application вынести в отдельный файлы
  - пока не увлекайся рефакторингом. делай на месте

---

- [x] formatting
- [ ] linting
- [ ] typecheck

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
