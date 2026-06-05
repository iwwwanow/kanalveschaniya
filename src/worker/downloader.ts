import { config } from "../config";
import { mkdirSync } from "fs";
import { join } from "path";

mkdirSync(config.tmpDir, { recursive: true });

export interface TrackInfo {
  id: string;
  title: string;
  url: string;
  duration?: number;
  isVideo: boolean;
  entries?: TrackInfo[]; // playlist
}

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

async function runYtDlp(args: string[]): Promise<string> {
  const baseArgs = config.proxy ? ["--proxy", config.proxy] : [];
  const proc = Bun.spawn(["yt-dlp", ...baseArgs, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`yt-dlp failed (${exitCode}): ${stderr.slice(0, 500)}`);
  }

  return stdout;
}

function parseMeta(raw: YtDlpMeta): TrackInfo {
  const isPlaylist = raw._type === "playlist" && Array.isArray(raw.entries);
  const isVideo = !!raw.vcodec && raw.vcodec !== "none";

  return {
    id: raw.id,
    title: raw.title,
    url: raw.webpage_url ?? raw.url ?? "",
    duration: raw.duration,
    isVideo,
    entries: isPlaylist ? raw.entries!.map(parseMeta) : undefined,
  };
}

export async function getInfo(url: string): Promise<TrackInfo> {
  const stdout = await runYtDlp(["--flat-playlist", "-J", url]);
  const raw: YtDlpMeta = JSON.parse(stdout);
  return parseMeta(raw);
}

export interface DownloadResult {
  filePath: string;
  title: string;
  duration?: number;
  isVideo: boolean;
  fileSize: number;
}

export async function download(url: string): Promise<DownloadResult> {
  // First get metadata to decide format
  const infoStdout = await runYtDlp(["-J", "--no-playlist", url]);
  const meta: YtDlpMeta = JSON.parse(infoStdout);
  const isVideo = !!meta.vcodec && meta.vcodec !== "none";

  const outputTemplate = join(config.tmpDir, `${meta.id}.%(ext)s`);

  if (isVideo) {
    await runYtDlp([
      "--no-playlist",
      "-f", "bestvideo+bestaudio",
      "--merge-output-format", "mp4",
      "-o", outputTemplate,
      url,
    ]);
  } else {
    await runYtDlp([
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
  const file = Bun.file(filePath);
  const fileSize = file.size;

  return {
    filePath,
    title: meta.title,
    duration: meta.duration,
    isVideo,
    fileSize,
  };
}
