import type { Database } from "bun:sqlite";
import type { ResourceRepository, Resource } from "../../domain/resource";

interface ResourceRow {
  resource_id: string;
  url: string;
  title: string | null;
  duration: number | null;
}

export function createResourceRepository(db: Database): ResourceRepository {
  return {
    async findByResourceId(resourceId) {
      const row = db
        .query<ResourceRow, [string]>(`SELECT resource_id, url, title, duration FROM resource WHERE resource_id = ?`)
        .get(resourceId);
      if (!row) return null;
      return {
        resourceId: row.resource_id,
        url: row.url,
        title: row.title ?? "",
        duration: row.duration ?? 0,
      };
    },

    async save(resource: Resource) {
      db.run(`INSERT OR REPLACE INTO resource (resource_id, url, title, duration) VALUES (?, ?, ?, ?)`, [
        resource.resourceId,
        resource.url,
        resource.title,
        resource.duration,
      ]);
    },
  };
}
