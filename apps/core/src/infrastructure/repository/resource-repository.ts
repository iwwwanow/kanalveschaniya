import type { Database } from "bun:sqlite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { ResourceRepository, Resource } from "../../domain/resource";
import { resourceTable } from "../db/schema/app";

export function createResourceRepository(db: Database): ResourceRepository {
  const orm = drizzle(db);

  return {
    async findByResourceId(resourceId) {
      const row = orm.select().from(resourceTable).where(eq(resourceTable.resourceId, resourceId)).get();
      if (!row) return null;
      return {
        resourceId: row.resourceId,
        url: row.url,
        title: row.title ?? "",
        duration: row.duration ?? 0,
      };
    },

    // Same as the old INSERT OR REPLACE: a re-save overwrites the row and refreshes cached_at.
    async save(resource: Resource) {
      const values = { url: resource.url, title: resource.title, duration: resource.duration };
      orm
        .insert(resourceTable)
        .values({ resourceId: resource.resourceId, ...values })
        .onConflictDoUpdate({ target: resourceTable.resourceId, set: { ...values, cachedAt: sql`(unixepoch())` } })
        .run();
    },
  };
}
