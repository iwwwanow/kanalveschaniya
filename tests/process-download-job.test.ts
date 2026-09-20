import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { BlockReason } from "../src/domain/block-reason";
import { MB, makeFile, resource, rig, tmpDir } from "./helpers";

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

describe("processDownloadJob: queue row hygiene", () => {
  test("a job that succeeds after a failed attempt ends with error and block_reason cleared", async () => {
    const dir = tmpDir();
    let attempt = 0;
    const r = rig({
      download: async () => {
        attempt++;
        if (attempt === 1) return { ok: false, error: "network timeout", retryable: true };
        return { ok: true, resource, filePath: makeFile(dir, 10) };
      },
    });

    const first = await r.runOnce();
    expect(first.error).toBe("network timeout");

    r.db.run("UPDATE queue SET retry_after = 0");
    const second = await r.processNext();
    expect(second.status).toBe("done");
    expect(second.error).toBeNull();
    expect(second.block_reason).toBeNull();
  });

  test("resource_id is stored right after getInfo, so a retry does not look it up again", async () => {
    const r = rig({ download: async () => ({ ok: false, error: "network timeout", retryable: true }) });
    const first = await r.runOnce();

    expect(first.resource_id).toBe(resource.resourceId);
    expect(r.infoCalls()).toBe(1);

    r.db.run("UPDATE queue SET retry_after = 0");
    await r.processNext();
    expect(r.infoCalls()).toBe(1); // second attempt reused job.resourceId
  });
});

describe("processDownloadJob: archive hits (no cache, or cache miss)", () => {
  test("fs-only: an archived resource is sent from disk, not downloaded again, and the file is kept", async () => {
    const dir = tmpDir();
    const archived = makeFile(dir, 10);
    const r = rig({ withCache: false, archiveHit: archived });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual([]); // no download, no save
    expect(r.notes).toEqual([{ ok: true, resource, filePath: archived }]);
    expect(existsSync(archived)).toBe(true);
  });

  test("cache miss but archive hit -> sent from the archive instead of downloading", async () => {
    const archived = makeFile(tmpDir(), 10);
    const r = rig({ archiveHit: archived });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual([]);
    expect(r.notes).toHaveLength(1);
  });

  test("playlist entries found in the archive are delivered at once, the rest are queued", async () => {
    const archived = makeFile(tmpDir(), 10);
    const other = { resourceId: "r2", url: "http://x/r2", title: "Other", duration: 5 };
    const r = rig({ withCache: false, archiveHit: archived, info: async () => ({ entries: [resource, other] }) });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.notes).toHaveLength(1); // the archived entry
    expect(r.playlistSummaries).toEqual([{ queued: 1, cached: 1 }]);
    expect(r.db.query<{ c: number }, []>("SELECT COUNT(*) c FROM queue WHERE resource_id = 'r2'").get()!.c).toBe(1);
  });
});
