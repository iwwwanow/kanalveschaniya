import type { Database } from "bun:sqlite";
import type { ErrorLogRepository } from "../../domain/error-log";

export function createErrorLogRepository(db: Database): ErrorLogRepository {
  return {
    async add(jobId, url, error) {
      db.run(`INSERT INTO error_log (job_id, url, error) VALUES (?, ?, ?)`, [jobId, url, error]);
    },
  };
}
