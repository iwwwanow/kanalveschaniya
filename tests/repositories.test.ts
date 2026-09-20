import { describe, expect, test } from "bun:test";
import { QueueStatus } from "../src/domain/queue";
import { BlockReason } from "../src/domain/block-reason";
import { openTelegramDb } from "../src/infrastructure/db/telegram-db";
import { createErrorLogRepository } from "../src/infrastructure/repository/error-log-repository";
import { createQueueRepository } from "../src/infrastructure/repository/queue-repository";
import { createResourceRepository } from "../src/infrastructure/repository/resource-repository";
import { createTelegramReplyRefsRepository } from "../src/infrastructure/repository/telegram-reply-refs";
import { createTelegramResourceRefsRepository } from "../src/infrastructure/repository/telegram-resource-refs";
import { createTelegramUsersRepository } from "../src/infrastructure/repository/telegram-users";
import { newAppDb, tmpDir } from "./helpers";

describe("queue repository", () => {
  test("enqueue returns the new id; findPending* see pending/processing jobs only", async () => {
    const { db } = newAppDb();
    const queue = createQueueRepository(db);

    const a = await queue.enqueue({ url: "http://a", userId: 1, resourceId: "ra" });
    const b = await queue.enqueue({ url: "http://b", userId: 1 });
    expect(b).toBeGreaterThan(a);

    expect((await queue.findPendingByUrl("http://a"))?.id).toBe(a);
    expect((await queue.findPendingByResourceId("ra"))?.id).toBe(a);
    expect((await queue.findPendingByResourceId("nope"))).toBeNull();

    await queue.updateStatus(a, QueueStatus.Done);
    expect(await queue.findPendingByUrl("http://a")).toBeNull();
  });

  test("claim takes the oldest claimable job, marks it processing, and skips jobs whose retry_after is in the future", async () => {
    const { db } = newAppDb();
    const queue = createQueueRepository(db);
    const later = await queue.enqueue({ url: "http://later", userId: 1 });
    const now = await queue.enqueue({ url: "http://now", userId: 1 });
    await queue.updateStatus(later, QueueStatus.Pending, { retryAfter: Math.floor(Date.now() / 1000) + 3600 });

    const claimed = await queue.claim();
    expect(claimed?.id).toBe(now);
    expect(claimed?.status).toBe(QueueStatus.Processing);
    expect(await queue.claim()).toBeNull(); // the other one waits for its backoff
    expect((await queue.findStuckProcessing()).map((j) => j.id)).toEqual([now]);
  });

  test("updateStatus changes only the fields in the patch", async () => {
    const { db } = newAppDb();
    const queue = createQueueRepository(db);
    const id = await queue.enqueue({ url: "http://a", userId: 1 });
    await queue.updateStatus(id, QueueStatus.Failed, { error: "boom", blockReason: BlockReason.Drm, retries: 2 });
    await queue.updateStatus(id, QueueStatus.Pending, { retryAfter: 123 });

    const row = db.query<Record<string, unknown>, [number]>("SELECT * FROM queue WHERE id = ?").get(id)!;
    expect(row).toMatchObject({ status: "pending", error: "boom", block_reason: "drm", retries: 2, retry_after: 123 });

    await queue.updateStatus(id, QueueStatus.Done, { error: null, blockReason: null });
    expect(db.query<Record<string, unknown>, [number]>("SELECT * FROM queue WHERE id = ?").get(id)).toMatchObject({
      status: "done",
      error: null,
      block_reason: null,
    });
  });
});

describe("resource / error log repositories", () => {
  test("resource: save overwrites the row (title, duration) and refreshes it; missing title/duration read as empty", async () => {
    const { db } = newAppDb();
    const repo = createResourceRepository(db);

    await repo.save({ resourceId: "r", url: "http://old", title: "Old", duration: 10 });
    await repo.save({ resourceId: "r", url: "http://new", title: "New", duration: 20 });
    expect(await repo.findByResourceId("r")).toEqual({ resourceId: "r", url: "http://new", title: "New", duration: 20 });
    expect(await repo.findByResourceId("missing")).toBeNull();

    db.run("INSERT INTO resource (resource_id, url) VALUES ('bare', 'http://bare')");
    expect(await repo.findByResourceId("bare")).toEqual({ resourceId: "bare", url: "http://bare", title: "", duration: 0 });
  });

  test("error log: every failure is appended", async () => {
    const { db } = newAppDb();
    const repo = createErrorLogRepository(db);
    await repo.add(1, "http://a", "first");
    await repo.add(1, "http://a", "second");
    expect(db.query<{ c: number }, []>("SELECT COUNT(*) c FROM error_log").get()!.c).toBe(2);
  });
});

describe("telegram repositories", () => {
  const open = () => openTelegramDb(tmpDir("kv-tg-"));

  test("reply refs: save replaces the previous ref of the same job", async () => {
    const repo = createTelegramReplyRefsRepository(open());
    await repo.save(1, 100, 5);
    await repo.save(1, 200, null);
    expect(await repo.get(1)).toEqual({ jobId: 1, chatId: 200, messageId: null });
    expect(await repo.get(2)).toBeNull();
  });

  test("resource refs: save replaces the channel message of the same resource", async () => {
    const repo = createTelegramResourceRefsRepository(open());
    await repo.save("r", 1);
    await repo.save("r", 2);
    expect(await repo.get("r")).toEqual({ resourceId: "r", channelMessageId: 2 });
  });

  test("users: the first username wins (insert or ignore)", async () => {
    const db = open();
    const repo = createTelegramUsersRepository(db);
    await repo.upsert(7, "first");
    await repo.upsert(7, "second");
    expect(db.query<{ username: string }, []>("SELECT username FROM users WHERE user_id = 7").get()!.username).toBe("first");
  });
});
