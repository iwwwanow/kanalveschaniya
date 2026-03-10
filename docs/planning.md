- нужно подготовить телеграм интерфейс для работы с этим софтом - https://github.com/yt-dlp/yt-dlp
- нужна работа с хранилищем. либо дописывать свою прослойку на sqlite, либо использвоать средства этого пакета - скажи как лучше
- при скачивании своего плейлиста использовал эту команду - `yt-dlp --proxy socks5://localhost:9090 --cookies cookies.txt --hls-prefer-native --download-archive archive.txt --no-overwrites --continue --sleep-interval 5 --max-sleep-interval 10 "https://soundcloud.com/iwwwanowwwwwww/likes"`
- хочу, чтобы пользователь отправляля ссылку в телеграме - ему в ответ сообщения аудиофайлов - либо уже скачанный файл, либо скачиваем его, добавляем в очередь (отмечаем как скачанный и далее отправляем)

---

- [ ] 1. переходи на node
  - в бд наверное лучше использовать просто knex
- [ ] 2. https://github.com/3rd/diagram.nvim, https://plantuml.com/ru/running
  - начерти схему. путаешься
  - по ней и работай
  - d2 docs: https://d2lang.com/tour/containers/
  - d2 styles: https://d2lang.com/tour/icons/
  - d2 sql styles: https://d2lang.com/tour/sql-tables/
