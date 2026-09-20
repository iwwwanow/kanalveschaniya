import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { ErrorLogRepository } from "../../domain/error-log";
import { errorLogTable } from "../db/schema/app";

export function createErrorLogRepository(db: Database): ErrorLogRepository {
  const orm = drizzle(db);

  return {
    async add(jobId, url, error) {
      orm.insert(errorLogTable).values({ jobId, url, error }).run();
    },
  };
}
