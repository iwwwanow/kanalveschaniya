# Бэкап БД перед деплоем 3.0.0 — где лежит и как восстановить

Копия боевых БД снята 2026-09-21 на Pi, **до** выкатки 3.0.0, пока работала 2.0.3: `/mnt/storage/backup/2026-09-21/app.db` и `telegram.db`
(снято `sqlite3 … ".backup …"` — согласованный снимок при работающем боте; в копии `app.db` было 127 строк в `queue`). Оригиналы — `/mnt/storage/data`
(`hostPath` из `iwwwanow_infrastructure/apps/dietpi/kanalveschaniya/deployment.yaml`). Копия лежит **только на той же Pi** (карта/диск узла) — вне узла её нет;
при необходимости забрать: `scp -O -r pi:/mnt/storage/backup/2026-09-21 ~/` (`-O` — из-за Dropbear).

Зачем: схема 3.0.0 несовместима с 2.x (`track_id` → `resource_id`, `telegram_track_refs` → `telegram_resource_refs`, Drizzle, новые колонки `queue`), откатить образ
на старый без копии БД нельзя. Восстановление: остановить бота (Flux вернёт ручной `scale` — менять надо образ/манифест в репозитории `infrastructure`), положить
`app.db`/`telegram.db` из копии на место `/mnt/storage/data/`, удалить рядом `app.db-wal`, `app.db-shm`, `telegram.db-wal`, `telegram.db-shm`, запустить образ `2.0.3`
(в манифесте сейчас `:latest`, поэтому на время отката тег `2.0.3` надо закрепить в `iwwwanow_infrastructure/apps/dietpi/kanalveschaniya/deployment.yaml`
и закоммитить — иначе рестарт снова потянет свежий `latest`). Удалять копию — когда 3.0.0 поработает без проблем.
