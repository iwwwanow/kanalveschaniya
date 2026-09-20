import type { Database } from "bun:sqlite";
import { mkdtempSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openAppDb } from "../src/infrastructure/db/app-db";
import { createQueueRepository } from "../src/infrastructure/repository/queue-repository";
import { createResourceRepository } from "../src/infrastructure/repository/resource-repository";
import { createErrorLogRepository } from "../src/infrastructure/repository/error-log-repository";
import { createDownloadJob } from "../src/application/download-job";
import { createDeliverJob } from "../src/application/deliver-job";
import type { WorkerLog } from "../src/application/worker-log";
import type { DownloadResult, DownloaderPort } from "../src/domain/download";
import type { NotifierPort } from "../src/domain/notifier";
import type { ResourceArchivePort, ResourceCachePort } from "../src/domain/resource-cache";
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
  cacheHit?: boolean; // the cache already holds `resource` before the job starts
  archiveHit?: string; // path of a file the archive can hand back for `resource`
  info?: () => Promise<{ entries: Resource[] } | Resource>;
  withCache?: boolean;
  download?: () => Promise<DownloadResult>;
  cacheSave?: () => Promise<void>;
  cacheDeliver?: () => Promise<void>;
  archiveSave?: () => Promise<void>;
  notify?: () => Promise<void>;
  maxFileSizeBytes?: number;
}

export interface QueueRow {
  id: number;
  status: string;
  retries: number;
  retry_after: number | null;
  error: string | null;
  block_reason: string | null;
  resource_id: string | null;
  file_path: string | null;
  deliver_retries: number;
  deliver_retry_after: number | null;
}

// Real sqlite + real repositories, fake downloader / notifier / stores; both job stages.
export function rig(opts: RigOptions = {}) {
  const { db, dir } = newAppDb();
  const queue = createQueueRepository(db);
  const calls: string[] = [];
  const notes: DownloadResult[] = [];
  const files: string[] = [];
  let infoCalls = 0;
  const playlistSummaries: Array<{ queued: number; cached: number }> = [];
  let cached = false;

  const cache: ResourceCachePort = {
    name: "cache",
    find: async () => (opts.cacheHit || cached ? resource : null),
    save: async () => {
      calls.push("cache.save");
      await opts.cacheSave?.();
      cached = true; // like the real channel cache: once saved, find() sees it
    },
    deliver: async () => {
      calls.push("cache.deliver");
      await opts.cacheDeliver?.();
    },
  };
  const archive: ResourceArchivePort = {
    name: "archive",
    find: async () => null,
    findFile: async (resourceId) =>
      opts.archiveHit && resourceId === resource.resourceId ? { resource, filePath: opts.archiveHit } : null,
    save: async () => {
      calls.push("archive.save");
      await opts.archiveSave?.();
    },
  };
  const downloader: DownloaderPort = {
    getInfo: async () => {
      infoCalls++;
      return opts.info ? opts.info() : resource;
    },
    download:
      opts.download ??
      (async () => {
        calls.push("download");
        const filePath = makeFile(dir, opts.size ?? 10);
        files.push(filePath);
        return { ok: true, resource, filePath };
      }),
  };
  const notifier: NotifierPort = {
    notify: async (_jobId, result) => {
      await opts.notify?.();
      notes.push(result);
    },
    notifyPlaylistQueued: async (_jobId, summary) => {
      playlistSummaries.push(summary);
    },
  };

  const caches = opts.withCache === false ? [] : [cache];
  const resources = createResourceRepository(db);
  const errorLog = createErrorLogRepository(db);
  const downloadJob = createDownloadJob({
    queue,
    downloader,
    resources,
    caches,
    archives: [archive],
    notifier,
    errorLog,
    maxFileSizeBytes: opts.maxFileSizeBytes ?? 50 * MB,
    registerPlaylistEntryOrigin: async () => {},
  });
  const deliverJob = createDeliverJob({ queue, resources, caches, notifier, errorLog });

  const row = (id: number) =>
    db.query<QueueRow, [number]>("SELECT * FROM queue WHERE id = ?").get(id)!;

  // Download stage: claims the next claimable `pending` job, runs it once, returns its row.
  async function downloadNext(): Promise<QueueRow> {
    const job = (await queue.claim())!;
    await downloadJob(job, noopLog);
    return row(job.id);
  }

  // Delivery stage: claims the next claimable `downloaded` job, runs it once, returns its row.
  async function deliverNext(): Promise<QueueRow> {
    const job = (await queue.claimForDelivery())!;
    await deliverJob(job, noopLog);
    return row(job.id);
  }

  // Enqueues a fresh job (optionally with download attempts already spent), runs the download stage.
  async function runOnce(retries = 0): Promise<QueueRow> {
    const id = await queue.enqueue({ url: `http://x/${Math.random()}`, userId: 1 });
    db.run("UPDATE queue SET retries = ? WHERE id = ?", [retries, id]);
    return downloadNext();
  }

  // Both stages back to back — what the two worker pools do for a healthy job.
  async function runThrough(): Promise<QueueRow> {
    const staged = await runOnce();
    return staged.status === "downloaded" ? deliverNext() : staged;
  }

  return {
    db,
    dir,
    queue,
    calls,
    notes,
    files,
    playlistSummaries,
    row,
    downloadNext,
    deliverNext,
    runOnce,
    runThrough,
    downloadJob,
    deliverJob,
    infoCalls: () => infoCalls,
  };
}
