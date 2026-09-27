import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import type { ProxyRepository } from "../../domain/proxy";
import { proxiesTable } from "../db/schema/session";

export function createProxiesRepository(db: Database): ProxyRepository {
  const orm = drizzle(db);

  return {
    async findById(id) {
      const row = orm.select().from(proxiesTable).where(eq(proxiesTable.id, id)).get();
      return row ? { id: row.id, url: row.url } : null;
    },
  };
}
