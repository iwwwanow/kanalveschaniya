import { mkdirSync } from "fs";
import { join } from "path";
import { config } from "../../config";
import type { Resource } from "../../domain/resource";
import type { DownloadResult, DownloaderPort } from "../../domain/download";
import { BlockReason } from "../../domain/block-reason";

mkdirSync(config.tmpDir, { recursive: true });

interface YtDlpMeta {
  id: string;
  title: string;
  webpage_url?: string;
  url?: string;
  duration?: number;
  vcodec?: string;
  entries?: YtDlpMeta[];
  _type?: string;
}

function isNotFound(error: string): boolean {
  return error.includes("HTTP Error 404");
}

function isGeoBlocked(error: string): boolean {
  return (
    error.includes("geo restriction") ||
    error.includes("not available in your country") ||
    error.includes("not available from your location")
  );
}

// Plan decision #7 (DRM fast-fail): pattern matches yt-dlp's stderr for content that is
// permanently undownloadable (e.g. SoundCloud Go+ tracks) — no retry can ever succeed.
function isDrmProtected(error: string): boolean {
  return error.includes("DRM protected");
}

async function spawnYtDlp(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const baseArgs = config.proxy ? ["--proxy", config.proxy] : [];
  const proc = Bun.spawn(["yt-dlp", ...baseArgs, ...args], { stdout: "pipe", stderr: "pipe" });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function runYtDlpOrThrow(args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await spawnYtDlp(args);
  if (exitCode !== 0) {
    throw new Error(`yt-dlp failed (${exitCode}): ${stderr.slice(0, 500)}`);
  }
  return stdout;
}

function metaToResource(meta: YtDlpMeta): Resource {
  return {
    resourceId: meta.id,
    // Flat-playlist entries have `url`, not `webpage_url` — both handled here.
    url: meta.webpage_url ?? meta.url ?? "",
    title: meta.title,
    duration: meta.duration ?? 0,
  };
}

export function createYtDlpDownloader(): DownloaderPort {
  return {
    async getInfo(url) {
      const stdout = await runYtDlpOrThrow(["--flat-playlist", "-J", url]);
      const raw: YtDlpMeta = JSON.parse(stdout);
      const isPlaylist = raw._type === "playlist" && Array.isArray(raw.entries);

      if (isPlaylist) {
        if (!config.allowPlaylistDownloads) {
          throw new Error(`playlist refused (ALLOW_PLAYLIST_DOWNLOADS=false) — ${raw.entries!.length} entries at ${url}`);
        }
        return { entries: raw.entries!.map(metaToResource) };
      }

      return metaToResource(raw);
    },

    async download(url): Promise<DownloadResult> {
      try {
        const infoStdout = await runYtDlpOrThrow(["-J", "--no-playlist", url]);
        const meta: YtDlpMeta = JSON.parse(infoStdout);

        // `--no-playlist` only suppresses expansion when a URL refers to BOTH a single
        // item and a playlist (e.g. a YouTube video inside a playlist) — a pure-playlist
        // URL (e.g. a SoundCloud /sets/ album) is still expanded here regardless, and
        // this would silently download every entry in sequence. See incident 2026-08-26.
        //
        // Refused unconditionally, independent of ALLOW_PLAYLIST_DOWNLOADS: that flag only
        // governs whether getInfo() fans a playlist out into individual per-resource jobs.
        // download() always downloads exactly one resource and returns exactly one
        // DownloadResult — it has no way to represent N files from one call, so letting
        // a playlist object through here (as the old `&& !config.allowPlaylistDownloads`
        // guard did) meant every entry after the first silently overwrote the previous
        // one on disk (outputTemplate keyed on the aggregate's own id, not each entry's),
        // and the DB ended up caching the wrong resource's id/title/duration entirely.
        const isPlaylist = meta._type === "playlist" || Array.isArray(meta.entries);
        if (isPlaylist) {
          return {
            ok: false,
            error: `playlist URL reached download() unexpectedly (should be fanned out by getInfo()) — ${url}`,
            retryable: false,
          };
        }

        const isVideo = !!meta.vcodec && meta.vcodec !== "none";
        const outputTemplate = join(config.tmpDir, `${meta.id}.%(ext)s`);

        if (isVideo) {
          await runYtDlpOrThrow([
            "--no-playlist",
            "-f", "bestvideo+bestaudio",
            "--merge-output-format", "mp4",
            "-o", outputTemplate,
            url,
          ]);
        } else {
          await runYtDlpOrThrow([
            "--no-playlist",
            "-f", "bestaudio",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", outputTemplate,
            url,
          ]);
        }

        const ext = isVideo ? "mp4" : "mp3";
        const filePath = join(config.tmpDir, `${meta.id}.${ext}`);

        return { ok: true, resource: metaToResource(meta), filePath };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        if (isDrmProtected(error)) return { ok: false, error, blockReason: BlockReason.Drm, retryable: false };
        if (isGeoBlocked(error)) return { ok: false, error, blockReason: BlockReason.Geo, retryable: false };
        if (isNotFound(error)) return { ok: false, error, retryable: false };

        return { ok: false, error, retryable: true };
      }
    },
  };
}
