import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { BlockReason } from "../src/domain/block-reason";
import { MB, rig } from "./helpers";

describe("processDownloadJob: outcomes", () => {
  test("file over the limit -> failed, block_reason=too_large, error_log entry, user notified, nothing stored", async () => {
    const r = rig({ size: 50 * MB + 1 });
    const row = await r.runOnce();

    expect(row.status).toBe("failed");
    expect(row.block_reason).toBe("too_large");
    expect(r.db.query<{ c: number }, []>("SELECT COUNT(*) c FROM error_log").get()!.c).toBe(1);
    expect(r.notes[0]).toMatchObject({ ok: false, blockReason: BlockReason.TooLarge });
    expect(r.calls).toEqual(["download"]); // downloaded, but never stored or delivered
  });

  test("cache hit -> deliver only, no download", async () => {
    const r = rig({ cacheHit: true });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual(["cache.deliver"]);
  });

  test("success stores in caches first, then archives; no direct notify when a cache delivered", async () => {
    const r = rig();
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual(["download", "cache.save", "cache.deliver", "archive.save"]);
    expect(r.notes).toHaveLength(0);
  });

  test("success without caches -> archived and sent to the user directly", async () => {
    const r = rig({ withCache: false });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual(["download", "archive.save"]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ ok: true });
  });
});

describe("processDownloadJob: retryable failures", () => {
  const transient = async () => ({ ok: false as const, error: "yt-dlp failed (1): network timeout", retryable: true });

  test("transient error -> pending, retries+1, backoff in the future, user not notified", async () => {
    const r = rig({ download: transient });
    const row = await r.runOnce();

    expect(row.status).toBe("pending");
    expect(row.retries).toBe(1);
    expect(row.retry_after!).toBeGreaterThan(Date.now() / 1000);
    expect(r.notes).toHaveLength(0);
  });

  test("transient error with retries exhausted -> failed, user notified once", async () => {
    const r = rig({ download: transient });
    const row = await r.runOnce(3);

    expect(row.status).toBe("failed");
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ ok: false });
  });

  test("non-retryable error (404) -> failed at once, retries untouched, user notified", async () => {
    const r = rig({ download: async () => ({ ok: false, error: "HTTP Error 404", retryable: false }) });
    const row = await r.runOnce();

    expect(row.status).toBe("failed");
    expect(row.retries).toBe(0);
    expect(r.notes).toHaveLength(1);
  });
});


describe("processDownloadJob: stores are isolated from each other", () => {
  const errorLogCount = (r: ReturnType<typeof rig>) =>
    r.db.query<{ c: number }, []>("SELECT COUNT(*) c FROM error_log").get()!.c;

  test("cache save fails -> the archive is still saved, the job is retried, the temp file is removed", async () => {
    const r = rig({ cacheSave: async () => { throw new Error("chat not found"); } });
    const row = await r.runOnce();

    expect(r.calls).toEqual(["download", "cache.save", "archive.save"]); // no deliver after a failed save
    expect(row.status).toBe("pending");
    expect(row.retries).toBe(1);
    expect(row.error).toContain("cache save: chat not found");
    expect(r.notes).toHaveLength(0); // no direct send when a cache exists but failed
    expect(existsSync(r.files[0]!)).toBe(false);
  });

  test("archive save fails after delivery -> job is done, no re-delivery, failure goes to error_log", async () => {
    const r = rig({ archiveSave: async () => { throw new Error("disk full"); } });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual(["download", "cache.save", "cache.deliver", "archive.save"]);
    expect(errorLogCount(r)).toBe(1);
  });

  test("archive-only mode: archive fails but the direct send succeeded -> done", async () => {
    const r = rig({ withCache: false, archiveSave: async () => { throw new Error("disk full"); } });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.notes).toHaveLength(1);
    expect(errorLogCount(r)).toBe(1);
  });
});
