# Прокси бота: mihomo вторым контейнером в поде вместо SSH-туннеля и privoxy

**Идея.** Заменить план из `2026-08-26_containerize-telegram-proxy.md` (под с `ssh -N -D` + `privoxy`) на один контейнер `metacubex/mihomo` (официальный образ, есть arm64/armv7) в поде бота. mihomo без TUN, только `mixed-port` — HTTP и SOCKS5 на одном порту, поэтому мост privoxy не нужен: `HTTPS_PROXY=http://localhost:7890` для Bun (ему нужен HTTP CONNECT) и `PROXY` для `yt-dlp --proxy` смотрят на один порт. Выход — не SSH до nl-timeweb, а VLESS/Reality-подписки из роли `sub` в `iwwwanow_infrastructure`: исчезает возня с `known_hosts` на Pi при смене host key, появляется fallback между серверами и правила (Telegram и гео-блоки — через прокси, остальное напрямую). Конфиг с URL подписки — `Secret`. Без TUN не нужны `NET_ADMIN` и правка маршрутов Pi.

**Гео-блоки по странам — не через API.** У mihomo есть REST API (`external-controller`: `PUT /proxies/<группа>` переключает сервер), но выбор в группе общий на процесс, а у бота `WORKER_CONCURRENCY` воркеров плюс трафик Telegram — переключение страны под одну загрузку заденет остальные. Вместо этого — `listeners` в конфиге mihomo: свой порт на каждый выход (например, 7891 → DE, 7892 → US), yt-dlp выбирает страну портом. API в боте — разве что только на чтение, для `/healthz` (`GET /group/<имя>/delay`).

**Проверить до перехода:**
- память на Pi 3B+ (955 Mi, уже упирался в ресурсы — `iwwwanow_infrastructure/docs/backlog/2026-08-26_pi3b-resource-starvation-flux-crashloop.md`); mihomo без TUN обычно занимает десятки МБ, но замерить;
- большие аплоады в канал через VLESS — раньше обрывались на прокси-туннеле (`2026-08-26_split-download-send-queue-events.md`, `2026-09-21_verify-long-upload-on-pi-after-deploy.md`);
- Reality с домашнего канала Pi — проблема с большим ClientHello и DPI, `iwwwanow_infrastructure/docs/backlog/2026-10-13_reality-big-clienthello-dpi.md`.
