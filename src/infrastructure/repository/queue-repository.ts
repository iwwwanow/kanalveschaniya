// why we dont use drizzle?
import type { Database } from "bun:sqlite";
import { type QueueItem, type QueueRepository, QueueStatus } from "../../domain/queue";
import { parseBlockReason } from "../../domain/block-reason";

interface QueueRow {
  id: number;
  url: string;
  resource_id: string | null;
  user_id: number;
  status: QueueStatus;
  block_reason: string | null;
  retries: number;
  retry_after: number | null;
  error: string | null;
  created_at: number;
}

function toQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    url: row.url,
    resourceId: row.resource_id,
    userId: row.user_id,
    status: row.status,
    error: row.error,
    blockReason: parseBlockReason(row.block_reason),
    retries: row.retries,
    retryAfter: row.retry_after,
    createdAt: row.created_at,
  };
}

export function createQueueRepository(db: Database): QueueRepository {
  return {
    async enqueue(item) {
      const result = db.run(`INSERT INTO queue (url, user_id, resource_id) VALUES (?, ?, ?)`, [
        item.url,
        item.userId,
        item.resourceId ?? null,
      ]);
      return Number(result.lastInsertRowid);
    },

    async findPendingByUrl(url) {
      const row = db
        .query<QueueRow, [string]>(
          `SELECT * FROM queue WHERE url = ? AND status IN ('pending', 'processing') ORDER BY id ASC LIMIT 1`
        )
        .get(url);
      return row ? toQueueItem(row) : null;
    },

    async findPendingByResourceId(resourceId) {
      const row = db
        .query<QueueRow, [string]>(
          `SELECT * FROM queue WHERE resource_id = ? AND status IN ('pending', 'processing') ORDER BY id ASC LIMIT 1`
        )
        .get(resourceId);
      return row ? toQueueItem(row) : null;
    },

    async claim() {
      const row = db
        .query<QueueRow, []>(
          `SELECT * FROM queue
           WHERE status = 'pending' AND (retry_after IS NULL OR retry_after <= unixepoch())
           ORDER BY id ASC LIMIT 1`
        )
        .get();
      if (!row) return null;
      db.run(`UPDATE queue SET status = 'processing' WHERE id = ?`, [row.id]);
      return toQueueItem({ ...row, status: QueueStatus.Processing });
    },

    async updateStatus(id, status, patch) {
      const sets: string[] = ["status = ?"];
      const values: Array<string | number | null> = [status];

      if (patch) {
        if (patch.error !== undefined) {
          sets.push("error = ?");
          values.push(patch.error);
        }
        if (patch.blockReason !== undefined) {
          sets.push("block_reason = ?");
          values.push(patch.blockReason);
        }
        if (patch.retries !== undefined) {
          sets.push("retries = ?");
          values.push(patch.retries);
        }
        if (patch.retryAfter !== undefined) {
          sets.push("retry_after = ?");
          values.push(patch.retryAfter);
        }
      }

      values.push(id);
      db.run(`UPDATE queue SET ${sets.join(", ")} WHERE id = ?`, values);
    },

    async requeueByBlockReason(reason, newStatus, staggerSeconds = 0) {
      db.run(
        `UPDATE queue SET status = ?, retries = 0, error = NULL, block_reason = NULL,
           retry_after = unixepoch() + ranked.rn * ?
         FROM (SELECT id, (ROW_NUMBER() OVER (ORDER BY id) - 1) AS rn FROM queue WHERE block_reason = ?) AS ranked
         WHERE queue.id = ranked.id`,
        [newStatus, staggerSeconds, reason]
      );
    },

    async findStuckProcessing() {
      const rows = db.query<QueueRow, []>(`SELECT * FROM queue WHERE status = 'processing'`).all();
      return rows.map(toQueueItem);
    },

    async countByStatusForUser(userId) {
      const rows = db
        .query<{ status: string; count: number }, [number]>(
          `SELECT status, COUNT(*) as count FROM queue WHERE user_id = ? GROUP BY status`
        )
        .all(userId);
      const result: Record<string, number> = {};
      for (const r of rows) result[r.status] = r.count;
      return result;
    },
  };
}
