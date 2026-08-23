# Backlog

## Контейнеризовать прокси-цепочку для обхода блокировки Telegram API

Сейчас (сессия 2026-08-23) обход блокировки `api.telegram.org` с домашней сети сделан **вручную на хосте** `dietpi` — SSH-туннель (`timeweb-socks5.service`) + `privoxy`-мост (SOCKS5→HTTP), оба systemd-юнитами прямо на Pi, не в GitOps. Подробности — `infrastructure/docs/k3s-flux-bootstrap.md`, раздел "Обход блокировки Telegram API" в Фазе 5.

**Почему цепочка именно такая** (не просто SOCKS5): связка `Telegraf`→`node-fetch`→кастомный `http.Agent` (`socks-proxy-agent`) не работает под Bun — запрос через SOCKS5-агент зависает навсегда без ошибки. `HttpsProxyAgent` (HTTP CONNECT) сработал. SSH сам HTTP не умеет (только SOCKS через `-D`), отсюда мост `privoxy`.

**Задача на потом** — перенести это в `infrastructure`-репозиторий как нормальный GitOps-компонент:
- Один общий Docker-образ (`debian-slim` + `apt-get install openssh-client privoxy`), публикуется через свою CI прямо в `infrastructure`-репозитории (`images/telegram-proxy/Dockerfile` + отдельный workflow)
- Один `Pod` с двумя контейнерами из этого образа (общий network namespace → общаются через `localhost`, не нужен `0.0.0.0`-костыль, которым обходили изоляцию хост/под): `ssh -N -D` в одном, `privoxy` в другом
- `Service` перед подом — стабильный DNS вместо IP ноды в `PROXY`
- SSH-ключ — `Secret` + volume-mount, не в образе

Цель — чтобы разворачивание на новом хосте не требовало ручного `apt-get`/`sed`/systemd на самой машине, а сводилось к применению манифестов + один секрет с SSH-ключом под нужный VPS-выход.

Не блокирует текущий деплой — рабочий стопгэп на хосте уже есть и протестирован (`curl` через `privoxy` → Telegram отвечает `302`).
