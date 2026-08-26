# `error_log`-запись в обход репозитория

Найдено в ревью 2026-08-24 (заметка на `logError()` в
`application/process-download-job.ts`: "sql прям в app?"). `logError()` делает
`deps.appDb.run("INSERT INTO error_log ...")` напрямую — единственное место в
`application/`, где код трогает `Database` без порта/репозитория. Решение осознанное
(план-решение из `docs/diary/2026-08-23_infra-restructure-plan.md`: "`error_log`→`app.db`,
пишет `ProcessDownloadJob` напрямую, без репозитория" — сочли отдельный
`ErrorLogRepository` избыточным для write-only лога), но это единственная дыра в правиле
"application не трогает `Database` напрямую", которое везде больше соблюдается.

Не блокирует — риск не в текущем поведении, а в том, что дыра создаёт прецедент: следующий
похожий случай ("ну тут же уже есть один raw-SQL") добавится проще, чем через порт.
Если захочется закрыть — `ErrorLogRepository` с одним методом `log(jobId, url, error)`,
пара строк.
