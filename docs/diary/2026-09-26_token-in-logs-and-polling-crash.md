# 2026-09-26 — токен в логах и падение процесса на ECONNRESET к api.telegram.org

## Откуда пришло

С Pi: под перезапускался ещё 8 раз (счётчик 1538 → 1546), последний раз 09-23 14:54, exit code 1. В логах —
необработанный `ECONNRESET` на запросе `getUpdates`, и **в трассировке напечатан полный URL, то есть токен
бота открытым текстом**. Кластер тут ни при чём, оба симптома — баг этого репозитория.

Токен уже утекал так раньше: в `infrastructure/docs/k3s-flux-bootstrap.md` (фаза 5) прямо записано, что за одну
сессию его пришлось перевыпускать три раза, и вывод там был «аккуратнее с тем, что копируешь в чат». Теперь
причина закрыта в коде, а не в дисциплине.

## Почему падало (проверено эмпирически, не по догадке)

Telegraf в своём polling-цикле (`node_modules/telegraf/lib/core/network/polling.js`) ретраит упавший
`getUpdates` только если `err.name === 'FetchError'` (плюс `TelegramError` с 429/5xx). Всё остальное —
`throw`.

Telegraf ходит в API через `node-fetch`, и пакет действительно лежит в `node_modules` (2.7.0), но **Bun
подменяет `node-fetch` своим нативным fetch** — проверено: `import fetch from "node-fetch"` под Bun печатает
собственную реализацию Bun (`at async fetch (node-fetch:96:41)`). А у нативной ошибки Bun:

```
name: Error            <- не "FetchError"
code: ConnectionRefused / ECONNRESET
message: Unable to connect. Is the computer able to access the url?
path: https://api.telegram.org/bot<TOKEN>/getUpdates
stack: undefined
```

Отсюда сразу оба симптома:

1. `name !== "FetchError"` → ретрая нет → ошибка вылетает из `polling.loop`, из `bot.launch()` (который в
   `main.ts` вызывался без `await`) → unhandled rejection → Bun валит процесс с кодом 1. Kubernetes поднимает
   под заново, вреда почти нет, но 8 перезапусков и потерянное состояние воркеров на пустом месте.
2. Токен печатает **дефолтный обработчик Bun**: он выводит поля ошибки, включая `path` с полным URL.
   Телеграфовский `redactToken` не помогает принципиально — он переписывает только `error.message`, а URL
   лежал в `path`. (Тот же `redactToken`, кстати, уже ломал аплоады: см. комментарий в
   `adapters/telegram-client/send-media.ts` — под Bun он падал на попытке присвоить readonly `message`.)

## Что сделано

- `src/redact.ts` — `redact()` (маскирует и паттерн `<bot_id>:<token>`, с префиксом `bot`/`user` и без, и
  точный токен, зарегистрированный через `registerSecret()`), `describeError()` (одна строка: `name: message
  (code=…)`, поле `path` с URL намеренно выбрасывается, а `code` наоборот сохраняется — у ошибок Bun это
  единственное, что вообще идентифицирует сбой, `stack` там `undefined`). Модуль без импортов: его тянет и
  `application`, и логгер, и тесты, а `config.ts` бросает исключение без `BOT_TOKEN`.
- `logger.ts` — каждый аргумент проходит через `describeError`/`redact`.
- `application/job-support.ts` — `errorMessage()` тоже редачит: строка уезжает в `error_log`/`queue.error` и
  может попасть в ответ пользователю.
- `main.ts` — `registerSecret(config.botToken)` до первого лога; хендлеры `unhandledRejection` (логируем и
  живём дальше — перезапуск воркеров и бота теперь их собственная забота, а подвисший процесс ловит
  `/healthz`) и `uncaughtException` (логируем и выходим с 1: состояние неизвестно).
- `presentation/telegram-bot.ts` — `startBot(bot): BotRunner`: цикл перезапуска polling внутри процесса,
  пауза 5с (как у воркеров), `401` — единственный фатальный случай (неверный/отозванный токен, ретраить
  нечего, пусть под крашлупит заметно). `BotRunner.stop()` ставит флаг, чтобы SIGTERM во время паузы не
  приводил к новому запуску polling. Плюс `bot.catch` в `createBot`: дефолтный обработчик Telegraf ставит
  `process.exitCode = 1` и ре-throw'ит, то есть один неудачный `reply` (пользователь заблокировал бота) ронял
  весь polling.
- `tests/redact.test.ts` — 8 тестов: URL-форма, голый токен, несколько вхождений, отсутствие ложных
  срабатываний на обычной строке лога, зарегистрированный секрет, форма ошибки Bun (`path` не попадает в
  вывод, `code` попадает).

Проверено вживую, а не только юнит-тестами:

- скрипт с реальным `fetch` на закрытый порт + guard из `main.ts` → в логе
  `unhandled rejection: Error: Unable to connect... (code=ConnectionRefused)`, токена нет, процесс жив, exit 0
  (до фикса — exit 1 с URL в выводе);
- `startBot` против недостижимого `apiRoot` → три строки `polling failed, restarting in 5s` с интервалом 5с,
  токена нет, `runner.stop()` действительно завершает цикл.

`bun run typecheck` и `bun test` (71 тест: 63 прежних + 8 новых) — зелёные.

## Что осталось руками

**Перевыпустить токен через @BotFather** и обновить секрет на Pi. Старый токен лежит в логах контейнера на
Pi (и в истории терминала), фикс на это задним числом не действует — он только про то, чтобы впредь не
попадало:

```bash
# на Pi, после /revoke в @BotFather
kubectl -n kanalveschaniya create secret generic kanalveschaniya-secrets \
  --from-literal=BOT_TOKEN='<новый>' --from-literal=CHANNEL_ID='-100…' … \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n kanalveschaniya rollout restart deploy/kanalveschaniya
```

(секрет заводится вручную, `envFrom.secretRef`, в GitOps его нет — см. `infrastructure/docs/k3s-flux-bootstrap.md`,
фаза 5; там же остальные ключи, которые надо перечислить целиком, потому что `create secret` пересоздаёт объект.)

И после деплоя стоит глазами проверить в `kubectl logs`, что при следующем сетевом сбое строка выглядит как
`polling failed, restarting in 5s: Error: … (code=ECONNRESET)` без URL.
