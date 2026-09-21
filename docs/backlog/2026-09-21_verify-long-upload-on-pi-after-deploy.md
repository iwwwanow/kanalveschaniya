# После деплоя 3.0.0: проверить аплоад длинного трека на Pi

Единственное не подтверждённое в 3.0.0: аплоад файла стримится с диска (`Bun.file` в `FormData`, коммит `c132158`), и это **не проверено вживую** через CONNECT-прокси на Pi
с лимитом памяти 300Mi (раньше `bun` падал по OOM около 250–258Mi RSS при базовых 150–250Mi). Делать **после** деплоя и раскатки 3.0.0.

Проверка: отправить боту ссылку на аудио ≈ 25 минут (≈ 45 МБ — под фильтром 28 мин и под лимитом 50 МБ, худший допустимый случай) и смотреть в трёх окнах на Pi:
`kubectl -n kanalveschaniya logs -f deploy/kanalveschaniya`, `watch -n 2 kubectl -n kanalveschaniya top pod`, `kubectl -n kanalveschaniya get pod` (колонка RESTARTS).
Потом `kubectl -n kanalveschaniya describe pod | grep -A3 "Last State"` (нет ли `OOMKilled`) и `dmesg -T | grep -i "out of memory"`.

Успех: файл пришёл в канал и пользователю, `RESTARTS` не вырос, пик памяти заметно ниже 300Mi (≈280Mi и выше — считать не исправленным, даже без падения). В логах ожидаются
`staged for delivery`, `store=channel save done`, `deliver done`; обрыв через прокси теперь виден как `delivery retry in 30s` без повторного скачивания. Если OOM остаётся —
поднять лимит памяти в манифесте или резать аплоад на части. Связано с пунктом «Upload буферизует файл целиком в память» в `docs/agents/planning.md`,
подробности — `docs/backlog/2026-08-26_upload-buffers-full-file-oom.md`.
