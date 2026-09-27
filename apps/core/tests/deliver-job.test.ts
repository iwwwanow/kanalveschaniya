import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { createRecoverStuckJobs } from "../src/application/recover-stuck-jobs";
import { BlockReason } from "../src/domain/block-reason";
import { rig } from "./helpers";

const errorLogCount = (r: ReturnType<typeof rig>) =>
  r.db.query<{ c: number }, []>("SELECT COUNT(*) c FROM error_log").get()!.c;

// Lets the next delivery attempt through (skips the backoff wait).
const skipBackoff = (r: ReturnType<typeof rig>) => r.db.run("UPDATE queue SET deliver_retry_after = 0");

describe("delivery stage", () => {
  test("cache: save then deliver, staged file removed, job done and its staging columns cleared", async () => {
    const r = rig();
    const staged = await r.runOnce();
    const row = await r.deliverNext();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual(["download", "archive.save", "cache.save", "cache.deliver"]);
    expect(row.file_path).toBeNull();
    expect(existsSync(staged.file_path!)).toBe(false);
    expect(r.notes).toHaveLength(0);
  });

  test("without caches the staged file is sent to the user directly", async () => {
    const r = rig({ withCache: false });
    const staged = await r.runOnce();
    const row = await r.deliverNext();

    expect(row.status).toBe("done");
    expect(r.notes).toEqual([{ ok: true, resource: expect.anything(), filePath: staged.file_path! }]);
  });

  test("a failing delivery is retried WITHOUT downloading again, and succeeds later", async () => {
    let failures = 2;
    const r = rig({
      cacheSave: async () => {
        if (failures-- > 0) throw new Error("socket closed");
      },
    });
    const staged = await r.runOnce();

    const first = await r.deliverNext();
    expect(first.status).toBe("downloaded"); // back to the delivery queue
    expect(first.deliver_retries).toBe(1);
    expect(first.deliver_retry_after!).toBeGreaterThan(Date.now() / 1000);
    expect(first.error).toContain("socket closed");
    expect(existsSync(staged.file_path!)).toBe(true); // the staged file waits for the retry
    expect(await r.queue.claimForDelivery()).toBeNull(); // ...but not before the backoff has passed

    skipBackoff(r);
    expect((await r.deliverNext()).deliver_retries).toBe(2);
    skipBackoff(r);
    const done = await r.deliverNext();

    expect(done.status).toBe("done");
    expect(r.calls.filter((c) => c === "download")).toHaveLength(1); // the whole point
    expect(r.notes).toHaveLength(0);
  });

  test("a retry after a delivery that failed post-save does not upload the file again", async () => {
    let failures = 1;
    const r = rig({
      cacheDeliver: async () => {
        if (failures-- > 0) throw new Error("forward failed");
      },
    });
    await r.runOnce();
    await r.deliverNext();
    skipBackoff(r);
    const done = await r.deliverNext();

    expect(done.status).toBe("done");
    expect(r.calls.filter((c) => c === "cache.save")).toHaveLength(1);
    expect(r.calls.filter((c) => c === "cache.deliver")).toHaveLength(2);
  });

  test("delivery attempts exhausted -> failed, the user is told, the staged file is removed", async () => {
    const r = rig({ cacheSave: async () => { throw new Error("chat not found"); } });
    const staged = await r.runOnce();
    r.db.run("UPDATE queue SET deliver_retries = 3");
    const row = await r.deliverNext();

    expect(row.status).toBe("failed");
    expect(row.file_path).toBeNull();
    expect(existsSync(staged.file_path!)).toBe(false);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ ok: false });
    expect(errorLogCount(r)).toBeGreaterThan(0);
  });

  test("the staged file vanished (temp dir cleared by a restart) -> back to the download stage, spending an attempt", async () => {
    const r = rig();
    const staged = await r.runOnce();
    rmSync(staged.file_path!);
    const row = await r.deliverNext();

    expect(row.status).toBe("pending");
    expect(row.retries).toBe(1);
    expect(row.file_path).toBeNull();
    expect(row.retry_after!).toBeGreaterThan(Date.now() / 1000);

    // ...and it is downloaded again on the next pass
    r.db.run("UPDATE queue SET retry_after = 0");
    expect((await r.downloadNext()).status).toBe("downloaded");
    expect(r.calls.filter((c) => c === "download")).toHaveLength(2);
  });

  test("the staged file vanished and no download attempts are left -> failed, user notified", async () => {
    const r = rig();
    const staged = await r.runOnce();
    rmSync(staged.file_path!);
    r.db.run("UPDATE queue SET retries = 3");
    const row = await r.deliverNext();

    expect(row.status).toBe("failed");
    expect(r.notes).toHaveLength(1);
  });
});

describe("recoverStuckJobs: delivery stage", () => {
  function recover(r: ReturnType<typeof rig>) {
    const notes: unknown[] = [];
    const run = createRecoverStuckJobs({
      queue: r.queue,
      notifier: { notify: async (_id, res) => void notes.push(res), notifyPlaylistQueued: async () => {} },
    });
    return { notes, run: () => run({ info() {}, warn() {}, error() {} }) };
  }

  test("a crash mid-delivery counts as a delivery attempt and the job goes back to `downloaded`", async () => {
    const r = rig();
    const staged = await r.runOnce();
    await r.queue.claimForDelivery(); // -> delivering, then the process "dies"
    const { run } = recover(r);
    await run();

    const row = r.row(staged.id);
    expect([row.status, row.deliver_retries, row.retries]).toEqual(["downloaded", 1, 0]);
    expect(row.deliver_retry_after!).toBeGreaterThan(Date.now() / 1000);
    expect(existsSync(row.file_path!)).toBe(true);
  });

  test("repeated crashes mid-delivery -> failed/crashed_repeatedly, user notified, staged file removed", async () => {
    const r = rig();
    const staged = await r.runOnce();
    r.db.run("UPDATE queue SET status = 'delivering', deliver_retries = 2");
    const { run, notes } = recover(r);
    await run();

    const row = r.row(staged.id);
    expect([row.status, row.block_reason]).toEqual(["failed", "crashed_repeatedly"]);
    expect(row.file_path).toBeNull();
    expect(existsSync(staged.file_path!)).toBe(false);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ blockReason: BlockReason.CrashedRepeatedly });
  });
});
