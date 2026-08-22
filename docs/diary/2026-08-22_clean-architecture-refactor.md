# 2026-08-22 — переход на clean-архитектуру (application + infra)

Сессия — обсуждение архитектуры (код не трогали) + проверка GitHub Actions + ревью
итоговой схемы в `docs/diagram.d2`.

## GitHub Actions — сделано

`gh auth status` возвращал `HTTP 401 Bad credentials` — токен для аккаунта `kirill-ivanovvv`
протух. Починка оказалась не тривиальным `refresh`, а сменой активного аккаунта:

- `gh auth refresh -h github.com` **не сработал** — ругался на mismatch
  (`received credentials for iwwwanow, did you use the correct account in the browser?`),
  потому что репозиторий принадлежит организации/юзеру `iwwwanow`, а не `kirill-ivanovvv`.
- Починка: `gh auth login -h github.com` (чистый логин, не refresh) → выбрать аккаунт
  `iwwwanow` в браузере → стал активным автоматически.
- Старую битую запись `kirill-ivanovvv` можно убрать: `gh auth logout -h github.com -u kirill-ivanovvv`
  (необязательно, просто мусор).
- **Важно на будущее**: правильное имя репозитория — `iwwwanow/kanalveschaniya`
  (без префикса `iwwwanow_` в названии самого репо — этот префикс есть только в пути каталога
  на диске, `iwwwanow_kanalveschaniya`). `gh run list --repo iwwwanow/iwwwanow_kanalveschaniya`
  падает 404, правильно — `gh run list --repo iwwwanow/kanalveschaniya`.

Результат проверки: последний прогон CI (коммит `3a52e73`, 2026-08-19) — **success**
(release + docker jobs). Actions работоспособны.

## Архитектура: итоговое решение

Схема слоёв (рисует пользователь отдельно, здесь — словесная фиксация решений):

```
domain/           — только типы (Track, QueueJob, DownloadResult) + порты (интерфейсы):
                     QueueRepository, TrackRepository, DownloaderPort, NotifierPort.
                     Никакого entity/value-object слоя — оверинжиниринг для этого проекта.
                     "domain" здесь = контракты, а не поведенческая модель.

application/      — use-cases:
                     - EnqueueDownload   (юзер прислал url → создать job в очереди)
                     - ProcessDownloadJob (взять job → скачать → закешировать → notify)
                     notify user — часть ProcessDownloadJob (естественное завершение
                     жизненного цикла джобы, не отдельный use-case), но вызывается
                     через порт NotifierPort — сам use-case Telegraf не знает.

infra/
  downloader/      — YtDlpDownloader, реализует DownloaderPort (адаптер вокруг Bun.spawn yt-dlp)
  db/               — sqlite-репозитории, реализуют QueueRepository/TrackRepository
  telegram/
    bot/            — presentation-адаптер (driving): /start, /status, приём url, парсинг,
                       вызов use-cases. Также реализует NotifierPort.
    channel-cache/  — infra-адаптер (driven): TrackCachePort через приватный канал
                       (upload/forward/поиск file_id)
```

## Ключевые решения по ходу обсуждения

1. **Telegram — это два разных адаптера, не один.** `bot/` (presentation, driving —
   вызывает use-cases) и `channel-cache/` (infra, driven — реализует порт, вызывается
   use-case'ом). Смешивать в один "telegram-adapter" не стали — разная роль в
   hexagonal-архитектуре, разная тестируемость.

2. **Хранение chat_id/message_id для реплая юзеру — отдельная таблица, целиком в infra.**
   Сейчас в `queue` только `user_id` (бот шлёт просто DM, реплая на конкретное сообщение нет).
   Чтобы добавить реплай, НЕ расширяем `queue` полями телеграма — заводим отдельную таблицу:

   ```sql
   CREATE TABLE telegram_reply_refs (
     job_id     INTEGER PRIMARY KEY,
     chat_id    INTEGER NOT NULL,
     message_id INTEGER NOT NULL
   );
   ```

   Владелец — целиком `infra/telegram`, ни один use-case/domain-тип про неё не знает.

   Поток:
   - `bot` (presentation) вызывает `EnqueueDownload` → получает `jobId` через generic
     `QueueRepository`.
   - `bot`-адаптер сам, отдельным вызовом, пишет `TelegramReplyRepository.save(jobId, chatId, messageId)`.
   - Когда `ProcessDownloadJob` завершается и зовёт `NotifierPort.notify(jobId, result)` —
     это реализация в `infra/telegram/bot`: внутри метода адаптера делает **свой** lookup
     `TelegramReplyRepository.get(jobId)`, потом `sendMessage`/reply.

   Это осознанный доп. DB round-trip прямо в методе инфра-адаптера (не в use-case) —
   решили, что это нормально: одна и та же локальная SQLite, цена лишнего SELECT
   незначительна, а изоляция domain/application от специфики Telegram того стоит.
   Альтернативу (opaque-поле `reply_ref` прямо в `queue`, транзитом через use-case)
   отклонили — она смешивает владение схемой таблицы даже если код не лезет в поле.

## Финальная схема (docs/diagram.d2) — согласована

```
infrastructure -> application -> domain

infrastructure: {
  presentation: { telegram-bot }
  adapters: { yt-dlp }
  repository: { telegram, sqlite }
  workers: { queue-poller }
}

application: {
  use-cases: { enqueue-download, process-download }
}

domain: {
  interfaces: { download-result, queue-item, resource }
  ports: { downloader, notifier }
  repository: { queue, resource }
}
```

Ревью прошло в 2 раунда, оба замечания учтены в файле:

1. **`infrastructure.repository: { telegram, sqlite }`** — реплаи (chat_id/message_id → job_id)
   и трекинг сообщений в канале теперь под `telegram`-компонентом (не имплементирует
   доменные порты — приватная зона telegram-bot), `sqlite` — отдельно, имплементирует
   `domain.repository.queue`/`resource`. Физически обе — одна и та же SQLite-база
   (`data/bot.db`), разделение логическое (владение таблицами), не по технологии —
   важно не развести это случайно на две базы при реализации.
2. **`queue-item` вместо `queue-job`** (domain.interfaces) — сняло конфликт имён с
   use-case `process-download` (use-case про "download", очередь — про "item").

Все use-case'ы, порты и разделение telegram на presentation (`telegram-bot`, driving) vs
repository (`telegram`, driven, реплаи+channel) — зафиксированы, вопросов не осталось.
Схема готова как основа для рефакторинга каталогов.

## Остаток работы

- [ ] Собственно рефакторинг структуры каталогов под `domain/application/infra` по схеме
      выше — не начинали, только спроектировали
- [ ] Миграция `telegram_reply_refs` (или как её назовут при реализации) —
      добавить в `runMigrations()` (см. `src/db/schema.ts`) когда дойдём до реализации реплаев
- [ ] `Bun.cron()` — обсуждали как нативный планировщик Bun (minute-granularity, no-overlap
      guarantee); для основного `queue-poller` не подходит (нужна суб-минутная реакция,
      оставляем poll-loop), но пригодится для будущих периодических задач
      (sweep зависших `geo_blocked`/`failed`, очистка `TMP_DIR`) — не реализовывали, просто вариант на заметку
