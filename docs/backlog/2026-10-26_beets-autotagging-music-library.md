# beets — автотегирование музыкальной библиотеки (MusicBrainz, AcoustID, обложки)

Идея: mp3 в `CONTENT_DIR` лежат с тегами, которые собрал yt-dlp (название ролика, загрузчик вместо исполнителя, без альбома,
года и обложки). Привести их в порядок можно через **beets**: он сопоставляет файлы с MusicBrainz и проставляет название,
исполнителя, альбом, год, номер трека и жанр; плагины `fetchart` + `embedart` встраивают обложки, а `chroma` узнаёт трек по
аудио-отпечатку (AcoustID), так что работает даже на мусорных тегах и именах файлов. Можно гонять вручную по `CONTENT_DIR`, а можно
как пост-обработку в боте после архивации — но тогда теги в кэше-канале и в архиве разъедутся, это надо продумать.

Установка и минимальный конфиг (`~/.config/beets/config.yaml`, теги пишутся на месте, файлы не двигаются):

```bash
pipx install beets
pipx inject beets pyacoustid requests python3-discogs-client
apt install libchromaprint-tools   # fpcalc для chroma
```

```yaml
directory: ~/Music
import:
  copy: no
  move: no
  write: yes
plugins: chroma fetchart embedart lastgenre discogs
fetchart:
  sources: coverart itunes amazon albumart
embedart:
  auto: yes
```

```bash
beet import -q -l skipped.log <dir>   # только уверенные совпадения, остальное — в лог
beet import <dir>/проблемное          # интерактивный разбор пропущенного
beet import -s <dir>                  # singleton mode — для россыпи синглов
```

Подводные камни:
- Теги перезаписываются без отката — сначала бэкап.
- Без `-q` beets спрашивает подтверждение на каждый неоднозначный альбом — на большой библиотеке это часы.
- beets мыслит альбомами; у бота почти всё — одиночные треки, так что, скорее всего, нужен `-s`.
- Чего нет в MusicBrainz (SoundCloud, бутлеги, мелкие релизы — а это заметная часть того, что качает бот), beets не найдёт.
  Discogs-плагин частично закрывает пробел, но требует токен Discogs.

Альтернативы: **OneTagger** (есть CLI) — лучше для электроники, ищет по Beatport/Discogs/Bandcamp/Spotify; **MusicBrainz Picard** —
то же, что beets, но GUI, удобен для ручной доводки остатков; `kid3-cli` / `eyeD3` / `mid3v2` сами ничего не ищут — только ручное
или скриптовое редактирование тегов.
