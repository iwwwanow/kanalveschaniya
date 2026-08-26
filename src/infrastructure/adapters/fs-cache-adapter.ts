import { mkdir, copyFile, readdir } from "fs/promises";
import { join } from "path";
import type { Track, ResourceRepository } from "../../domain/resource";
import type { TrackStorePort } from "../../domain/track-cache";

export interface FsCacheAdapterDeps {
  contentDir: string;
  resource: ResourceRepository;
}

const EXTENSIONS = ["mp3", "mp4"] as const;

// title_trackId.ext — человекочитаемо при просмотре папки руками, а trackId в суффиксе
// даёт find() искать по нему без отдельного индекса path-по-track_id (readdir + суффикс).
function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").trim();
  return cleaned.slice(0, 150) || "track";
}

async function findLocalFile(contentDir: string, trackId: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const dir = join(contentDir, ext);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // папка ещё не создана
    }
    const match = entries.find((name) => name.endsWith(`_${trackId}.${ext}`));
    if (match) return join(dir, match);
  }
  return null;
}

export function createFsCacheAdapter(deps: FsCacheAdapterDeps): TrackStorePort {
  return {
    name: "fs",

    async find(trackId) {
      const path = await findLocalFile(deps.contentDir, trackId);
      if (!path) return null;
      return deps.resource.findByTrackId(trackId);
    },

    async save(track: Track, filePath: string) {
      const isVideo = filePath.endsWith(".mp4");
      const ext = isVideo ? "mp4" : "mp3";
      const destDir = join(deps.contentDir, ext);
      await mkdir(destDir, { recursive: true });
      const dest = join(destDir, `${sanitizeTitle(track.title)}_${track.trackId}.${ext}`);
      // copyFile, не rename — этот store никогда не забирает владение исходником;
      // application сам чистит временный файл после всех TrackStorePort.save().
      await copyFile(filePath, dest);
      await deps.resource.save(track);
    },
  };
}
