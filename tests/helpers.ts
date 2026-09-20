import type { Database } from "bun:sqlite";
import { mkdtempSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openAppDb } from "../src/infrastructure/db/app-db";
import { createQueueRepository } from "../src/infrastructure/repository/queue-repository";
import { createErrorLogRepository } from "../src/infrastructure/repository/error-log-repository";
import { createProcessDownloadJob } from "../src/application/process-download-job";
import type { WorkerLog } from "../src/application/worker-log";
import type { DownloadResult, DownloaderPort } from "../src/domain/download";
import type { NotifierPort } from "../src/domain/notifier";
import type { ResourceCachePort, ResourceStorePort } from "../src/domain/resource-cache";
import type { Resource } from "../src/domain/resource";

export const MB = 1024 * 1024;
export const noopLog: WorkerLog = { info() {}, warn() {}, error() {} };
export const resource: Resource = { resourceId: "r1", url: "http://x/r1", title: "T", duration: 10 };

export function tmpDir(prefix = "kv-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Sparse file of the given size — cheap way to exceed the upload limit.
export function makeFile(dir: string, size: number): string {
  const path = join(dir, `f${Math.random().toString(36).slice(2)}.mp3`);
  writeFileSync(path, "");
  truncateSync(path, size);
  return path;
}

export function newAppDb(): { db: Database; dir: string } {
  const dir = tmpDir();
  return { db: openAppDb(dir), dir };
}

export interface RigOptions {
  size?: number;
  cacheHit?: boolean;
  withCache?: boolean;
  download?: () => Promise<DownloadResult>;
  cacheSave?: () => Promise<void>;
  cacheDeliver?: () => Promise<void>;
  archiveSave?: () => Promise<void>;
  maxFileSizeBytes?: number;
}

// Real sqlite + real repositories, fake downloader / notifier / stores.
export function rig(opts: RigOptions = {}) {
  const { db, dir } = newAppDb();
  const queue = createQueueRepository(db);
  const calls: string[] = [];
  const notes: DownloadResult[] = [];

  const cache: ResourceCachePort = {
    name: "cache",
    find: async () => (opts.cacheHit ? resource : null),
    save: async () => {
      calls.push("cache.save");
      await opts.cacheSave?.();
    },
    deliver: async () => {
      calls.push("cache.deliver");
      await opts.cacheDeliver?.();
    },
  };
  const archive: ResourceStorePort = {
    name: "archive",
    find: async () => null,
    save: async () => {
      calls.push("archive.save");
      await opts.archiveSave?.();
    },
  };
  const downloader: DownloaderPort = {
    getInfo: async () => resource,
    download:
      opts.download ??
      (async () => {
        calls.push("download");
        return { ok: true, resource, filePath: makeFile(dir, opts.size ?? 10) };
      }),
  };
  const notifier: NotifierPort = {
    notify: async (_jobId, result) => {
      notes.push(result);
    },
    notifyPlaylistQueued: async () => {},
  };

  const process = createProcessDownloadJob({
    queue,
    downloader,
    caches: opts.withCache === false ? [] : [cache],
    archives: [archive],
    notifier,
    errorLog: createErrorLogRepository(db),
    maxFileSizeBytes: opts.maxFileSizeBytes ?? 50 * MB,
    registerPlaylistEntryOrigin: async () => {},
  });

  // Enqueues a job, claims it, runs it once, returns the resulting queue row.
  async function runOnce(retries = 0) {
    const id = await queue.enqueue({ url: `http://x/${Math.random()}`, userId: 1 });
    db.run("UPDATE queue SET retries = ? WHERE id = ?", [retries, id]);
    const job = (await queue.claim())!;
    await process(job, noopLog);
    return db
      .query<
        { status: string; retries: number; retry_after: number | null; error: string | null; block_reason: string | null },
        [number]
      >("SELECT status, retries, retry_after, error, block_reason FROM queue WHERE id = ?")
      .get(id)!;
  }

  return { db, dir, queue, calls, notes, runOnce };
}
