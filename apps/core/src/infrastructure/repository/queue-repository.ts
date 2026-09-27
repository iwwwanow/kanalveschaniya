import type { Database } from "bun:sqlite";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { type QueueItem, type QueueRepository, QueueStatus } from "../../domain/queue";
import { parseBlockReason, type QueueRow } from "shared-queue";
import { queueTable } from "../db/schema/app";

function toQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    url: row.url,
    resourceId: row.resourceId,
    userId: row.userId,
    status: row.status,
    error: row.error,
    blockReason: parseBlockReason(row.blockReason),
    serviceId: row.serviceId,
    retries: row.retries,
    retryAfter: row.retryAfter,
    filePath: row.filePath,
    deliverRetries: row.deliverRetries,
    deliverRetryAfter: row.deliverRetryAfter,
    createdAt: row.createdAt ?? 0,
  };
}

// a resource in any of these states is already on its way — don't enqueue it twice
const ACTIVE = [QueueStatus.Pending, QueueStatus.Processing, QueueStatus.Downloaded, QueueStatus.Delivering];

export function createQueueRepository(db: Database): QueueRepository {
  const orm = drizzle(db);

  return {
    async enqueue(item) {
      const row = orm
        .insert(queueTable)
        .values({ url: item.url, userId: item.userId, resourceId: item.resourceId ?? null })
        .returning({ id: queueTable.id })
        .get();
      return row.id;
    },

    async findPendingByUrl(url) {
      const row = orm
        .select()
        .from(queueTable)
        .where(and(eq(queueTable.url, url), inArray(queueTable.status, ACTIVE)))
        .orderBy(asc(queueTable.id))
        .limit(1)
        .get();
      return row ? toQueueItem(row) : null;
    },

    async findPendingByResourceId(resourceId) {
      const row = orm
        .select()
        .from(queueTable)
        .where(and(eq(queueTable.resourceId, resourceId), inArray(queueTable.status, ACTIVE)))
        .orderBy(asc(queueTable.id))
        .limit(1)
        .get();
      return row ? toQueueItem(row) : null;
    },

    async claim() {
      const row = orm
        .select()
        .from(queueTable)
        .where(
          and(
            eq(queueTable.status, QueueStatus.Pending),
            or(isNull(queueTable.retryAfter), lte(queueTable.retryAfter, sql`unixepoch()`)),
          ),
        )
        .orderBy(asc(queueTable.id))
        .limit(1)
        .get();
      if (!row) return null;
      orm.update(queueTable).set({ status: QueueStatus.Processing }).where(eq(queueTable.id, row.id)).run();
      return toQueueItem({ ...row, status: QueueStatus.Processing });
    },

    async claimForDelivery() {
      const row = orm
        .select()
        .from(queueTable)
        .where(
          and(
            eq(queueTable.status, QueueStatus.Downloaded),
            or(isNull(queueTable.deliverRetryAfter), lte(queueTable.deliverRetryAfter, sql`unixepoch()`)),
          ),
        )
        .orderBy(asc(queueTable.id))
        .limit(1)
        .get();
      if (!row) return null;
      orm.update(queueTable).set({ status: QueueStatus.Delivering }).where(eq(queueTable.id, row.id)).run();
      return toQueueItem({ ...row, status: QueueStatus.Delivering });
    },

    async setResourceId(id, resourceId) {
      orm.update(queueTable).set({ resourceId }).where(eq(queueTable.id, id)).run();
    },

    async setServiceId(id, serviceId) {
      orm.update(queueTable).set({ serviceId }).where(eq(queueTable.id, id)).run();
    },

    async updateStatus(id, status, patch) {
      const set: Partial<typeof queueTable.$inferInsert> = { status };
      if (patch?.error !== undefined) set.error = patch.error;
      if (patch?.blockReason !== undefined) set.blockReason = patch.blockReason;
      if (patch?.retries !== undefined) set.retries = patch.retries;
      if (patch?.retryAfter !== undefined) set.retryAfter = patch.retryAfter;
      if (patch?.filePath !== undefined) set.filePath = patch.filePath;
      if (patch?.deliverRetries !== undefined) set.deliverRetries = patch.deliverRetries;
      if (patch?.deliverRetryAfter !== undefined) set.deliverRetryAfter = patch.deliverRetryAfter;
      orm.update(queueTable).set(set).where(eq(queueTable.id, id)).run();
    },

    // Window function + UPDATE ... FROM: the query builder has no way to express it, so raw sql.
    // serviceId narrows the WHERE to just that service's jobs (session-service's per-service
    // unblock) — omitted, behaves exactly as before (core's own geo/PROXY call site).
    async requeueByBlockReason(reason, newStatus, staggerSeconds = 0, serviceId) {
      const serviceFilter = serviceId !== undefined ? sql`AND service_id = ${serviceId}` : sql``;
      orm.run(sql`
        UPDATE queue SET status = ${newStatus}, retries = 0, error = NULL, block_reason = NULL,
          retry_after = unixepoch() + ranked.rn * ${staggerSeconds}
        FROM (SELECT id, (ROW_NUMBER() OVER (ORDER BY id) - 1) AS rn FROM queue WHERE block_reason = ${reason} ${serviceFilter}) AS ranked
        WHERE queue.id = ranked.id`);
    },

    async findDistinctServiceIdsByBlockReason(reason) {
      const rows = orm
        .selectDistinct({ serviceId: queueTable.serviceId })
        .from(queueTable)
        .where(and(eq(queueTable.blockReason, reason), isNotNull(queueTable.serviceId)))
        .all();
      return rows.map((r) => r.serviceId as number);
    },

    async findStuckProcessing() {
      return orm.select().from(queueTable).where(eq(queueTable.status, QueueStatus.Processing)).all().map(toQueueItem);
    },

    async findStuckDelivering() {
      return orm.select().from(queueTable).where(eq(queueTable.status, QueueStatus.Delivering)).all().map(toQueueItem);
    },

    async countByStatusForUser(userId) {
      const rows = orm
        .select({ status: queueTable.status, count: sql<number>`count(*)` })
        .from(queueTable)
        .where(eq(queueTable.userId, userId))
        .groupBy(queueTable.status)
        .all();
      const result: Record<string, number> = {};
      for (const r of rows) result[r.status] = r.count;
      return result;
    },
  };
}
