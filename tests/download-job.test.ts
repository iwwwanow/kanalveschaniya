import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { BlockReason } from "../src/domain/block-reason";
import { MB, makeFile, resource, rig, tmpDir } from "./helpers";

const errorLogCount = (r: ReturnType<typeof rig>) =>
  r.db.query<{ c: number }, []>("SELECT COUNT(*) c FROM error_log").get()!.c;

describe("download stage: outcomes", () => {
  test("success -> the file is staged for delivery: status downloaded, unique staged path, resource saved, nothing sent yet", async () => {
    const r = rig();
    const row = await r.runOnce();

    expect(row.status).toBe("downloaded");
    expect(row.file_path).toContain(`staged-${row.id}-`);
    expect(existsSync(row.file_path!)).toBe(true);
    expect(existsSync(r.files[0]!)).toBe(false); // moved, not copied
    expect(r.calls).toEqual(["download", "archive.save"]); // archived right away; caches wait for the delivery stage
    expect(r.notes).toHaveLength(0);
    expect(r.db.query<{ c: number }, []>("SELECT COUNT(*) c FROM resource").get()!.c).toBe(1);
  });

  test("file over the limit -> failed, block_reason=too_large, error_log entry, user notified, nothing stored", async () => {
    const r = rig({ size: 50 * MB + 1 });
    const row = await r.runOnce();

    expect(row.status).toBe("failed");
    expect(row.block_reason).toBe("too_large");
    expect(errorLogCount(r)).toBe(1);
    expect(r.notes[0]).toMatchObject({ ok: false, blockReason: BlockReason.TooLarge });
    expect(r.calls).toEqual(["download"]); // downloaded, but never archived or staged
    expect(row.file_path).toBeNull();
  });

  test("cache hit -> deliver only, no download, done at once", async () => {
    const r = rig({ cacheHit: true });
    const row = await r.runOnce();

    expect(row.status).toBe("done");
    expect(r.calls).toEqual(["cache.deliver"]);
  });

  test("an archive failure is only logged: the job is still staged", async () => {
    const r = rig({ archiveSave: async () => { throw new Error("disk full"); } });
    const row = await r.runOnce();

    expect(row.status).toBe("downloaded");
    expect(errorLogCount(r)).toBe(1);
  });
});

describe("download stage: retryable failures", () => {
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

describe("download stage: queue row hygiene", () => {
  test("a job that succeeds after a failed attempt ends up with error and block_reason cleared", async () => {
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
    const second = await r.downloadNext();
    expect(second.status).toBe("downloaded");
    expect(second.error).toBeNull();
    expect(second.block_reason).toBeNull();
  });

  test("resource_id is stored right after getInfo, so a retry does not look it up again", async () => {
    const r = rig({ download: async () => ({ ok: false, error: "network timeout", retryable: true }) });
    const first = await r.runOnce();

    expect(first.resource_id).toBe(resource.resourceId);
    expect(r.infoCalls()).toBe(1);

    r.db.run("UPDATE queue SET retry_after = 0");
    await r.downloadNext();
    expect(r.infoCalls()).toBe(1); // second attempt reused job.resourceId
  });
});

describe("download stage: archive hits (no cache, or cache miss)", () => {
  test("fs-only: an archived resource is sent from disk, not downloaded again, and the file is kept", async () => {
    const archived = makeFile(tmpDir(), 10);
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
