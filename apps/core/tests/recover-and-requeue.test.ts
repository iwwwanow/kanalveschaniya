import { describe, expect, test } from "bun:test";
import { createRecoverStuckJobs } from "../src/application/recover-stuck-jobs";
import { createRequeueBlockedJobs } from "../src/application/requeue-blocked-jobs";
import { createGetUserQueueStatus } from "../src/application/get-user-queue-status";
import { BlockReason, parseBlockReason } from "../src/domain/block-reason";
import type { DownloadResult } from "../src/domain/download";
import { createQueueRepository } from "../src/infrastructure/repository/queue-repository";
import { newAppDb, noopLog } from "./helpers";

interface Row {
  status: string;
  retries: number;
  retry_after: number | null;
  error: string | null;
  block_reason: string | null;
  url: string;
}

describe("recoverStuckJobs", () => {
  test("a crash counts as an attempt; exhausted jobs become failed/crashed_repeatedly and notify the user", async () => {
    const { db } = newAppDb();
    const queue = createQueueRepository(db);
    const notes: DownloadResult[] = [];
    db.run("INSERT INTO queue (url,user_id,status,retries) VALUES ('u1',1,'processing',0),('u2',1,'processing',2)");

    await createRecoverStuckJobs({
      queue,
      notifier: { notify: async (_id, r) => void notes.push(r), notifyPlaylistQueued: async () => {} },
    })(noopLog);

    const a = db.query<Row, []>("SELECT * FROM queue WHERE url='u1'").get()!;
    const b = db.query<Row, []>("SELECT * FROM queue WHERE url='u2'").get()!;
    expect([a.status, a.retries]).toEqual(["pending", 1]);
    expect(a.retry_after!).toBeGreaterThan(0);
    expect([b.status, b.block_reason]).toEqual(["failed", "crashed_repeatedly"]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ blockReason: BlockReason.CrashedRepeatedly });
  });
});

describe("requeueBlockedJobs", () => {
  test("requeues only the given reason, resets counters and staggers retry_after", async () => {
    const { db } = newAppDb();
    const queue = createQueueRepository(db);
    db.run(
      `INSERT INTO queue (url,user_id,status,block_reason,retries,error) VALUES
       ('g1',1,'failed','geo',3,'e'),('g2',1,'failed','geo',3,'e'),('g3',1,'failed','geo',3,'e'),('d1',1,'failed','drm',3,'e')`,
    );

    await createRequeueBlockedJobs(queue)({ reason: BlockReason.Geo, staggerSeconds: 30 });

    const geo = db.query<Row, []>("SELECT * FROM queue WHERE url LIKE 'g%' ORDER BY id").all();
    expect(geo.every((r) => r.status === "pending" && r.retries === 0 && r.error === null && r.block_reason === null)).toBe(true);
    expect(geo[1]!.retry_after! - geo[0]!.retry_after!).toBe(30);
    expect(geo[2]!.retry_after! - geo[1]!.retry_after!).toBe(30);
    expect(db.query<Row, []>("SELECT * FROM queue WHERE url='d1'").get()!.status).toBe("failed");
  });
});

describe("misc domain/application helpers", () => {
  test("getUserQueueStatus counts jobs per status for the user", async () => {
    const { db } = newAppDb();
    const queue = createQueueRepository(db);
    db.run("INSERT INTO queue (url,user_id,status) VALUES ('a',1,'done'),('b',1,'done'),('c',1,'pending'),('d',2,'failed')");

    expect(await createGetUserQueueStatus(queue)(1)).toEqual({ done: 2, pending: 1 });
  });

  test("parseBlockReason maps known values and drops unknown ones", () => {
    expect(parseBlockReason("geo")).toBe(BlockReason.Geo);
    expect(parseBlockReason("nope")).toBeNull();
    expect(parseBlockReason(null)).toBeNull();
  });
});
