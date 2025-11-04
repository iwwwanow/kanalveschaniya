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
