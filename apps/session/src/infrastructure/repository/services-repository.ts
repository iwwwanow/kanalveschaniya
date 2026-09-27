import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import type { Service, ServiceRepository } from "../../domain/service";
import { servicesTable } from "../db/schema/session";

type ServiceRow = typeof servicesTable.$inferSelect;

function toService(row: ServiceRow): Service {
  return { id: row.id, name: row.name, urlPattern: row.urlPattern, requiresCookie: row.requiresCookie };
}

export function createServicesRepository(db: Database): ServiceRepository {
  const orm = drizzle(db);

  return {
    async findByUrl(url) {
      // A handful of rows at most (one per cookie-requiring platform) — scanning all of them and
      // matching in application code is simpler than pushing a LIKE per pattern into SQL, and
      // fast enough at this scale.
      const lower = url.toLowerCase();
      const match = orm
        .select()
        .from(servicesTable)
        .all()
        .find((row) => lower.includes(row.urlPattern.toLowerCase()));
      return match ? toService(match) : null;
    },

    async findById(id) {
      const row = orm.select().from(servicesTable).where(eq(servicesTable.id, id)).get();
      return row ? toService(row) : null;
    },
  };
}
