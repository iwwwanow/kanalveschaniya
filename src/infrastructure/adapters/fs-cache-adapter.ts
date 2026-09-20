import { mkdir, copyFile, readdir } from "fs/promises";
import { join } from "path";
import type { Resource, ResourceRepository } from "../../domain/resource";
import type { ResourceStorePort } from "../../domain/resource-cache";

export interface FsCacheAdapterDeps {
  contentDir: string;
  resource: ResourceRepository;
}

const EXTENSIONS = ["mp3", "mp4"] as const;

// title_resourceId.ext — человекочитаемо при просмотре папки руками, а resourceId в суффиксе
// даёт find() искать по нему без отдельного индекса path-по-resource_id (readdir + суффикс).
function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").trim();
  return cleaned.slice(0, 150) || "track";
}

async function findLocalFile(contentDir: string, resourceId: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const dir = join(contentDir, ext);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // папка ещё не создана
    }
    const match = entries.find((name) => name.endsWith(`_${resourceId}.${ext}`));
    if (match) return join(dir, match);
  }
  return null;
}

export function createFsCacheAdapter(deps: FsCacheAdapterDeps): ResourceStorePort {
  return {
    name: "fs",

    async find(resourceId) {
      const path = await findLocalFile(deps.contentDir, resourceId);
      if (!path) return null;
      return deps.resource.findByResourceId(resourceId);
    },

    async save(resource: Resource, filePath: string) {
      const isVideo = filePath.endsWith(".mp4");
      const ext = isVideo ? "mp4" : "mp3";
      const destDir = join(deps.contentDir, ext);
      await mkdir(destDir, { recursive: true });
      const dest = join(destDir, `${sanitizeTitle(resource.title)}_${resource.resourceId}.${ext}`);
      // copyFile, не rename — этот store никогда не забирает владение исходником;
      // application сам чистит временный файл после всех ResourceStorePort.save().
      await copyFile(filePath, dest);
      await deps.resource.save(resource);
    },
  };
}
