import { mkdirSync } from "fs";
import { join } from "path";
import { logger } from "./logger";
import { config } from "./config";
import { openAppDb } from "./infrastructure/db/app-db";
import { openTelegramDb } from "./infrastructure/db/telegram-db";
import { createQueueRepository } from "./infrastructure/repository/queue-repository";
import { createErrorLogRepository } from "./infrastructure/repository/error-log-repository";
import { createResourceRepository } from "./infrastructure/repository/resource-repository";
import { createTelegramReplyRefsRepository } from "./infrastructure/repository/telegram-reply-refs";
import { createTelegramTrackRefsRepository } from "./infrastructure/repository/telegram-track-refs";
import { createTelegramUsersRepository } from "./infrastructure/repository/telegram-users";
import { createYtDlpDownloader } from "./infrastructure/adapters/yt-dlp";
import { createTelegramNotifier } from "./infrastructure/adapters/telegram-notifier";
import { createTelegramChannelCache } from "./infrastructure/adapters/telegram-channel-cache";
import { createFsCacheAdapter } from "./infrastructure/adapters/fs-cache-adapter";
import type { TrackStorePort, TrackCachePort } from "./domain/track-cache";
import { createEnqueueDownload } from "./application/enqueue-download";
import { createGetUserQueueStatus } from "./application/get-user-queue-status";
import { createRecoverStuckJobs } from "./application/recover-stuck-jobs";
import { createRequeueBlockedJobs } from "./application/requeue-blocked-jobs";
import { BlockReason } from "./domain/block-reason";
import { createProcessDownloadJob } from "./application/process-download-job";
import { createBot } from "./infrastructure/presentation/telegram-bot";
import { startHealthServer } from "./infrastructure/presentation/health-server";
import { startQueuePoller } from "./infrastructure/workers/queue-poller";

// DATA_DIR handling preserved as-is (read directly, not via config.ts) — resolves
// app.db + telegram.db.
const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "../data");
mkdirSync(dataDir, { recursive: true });

const appDb = openAppDb(dataDir);
const telegramDb = openTelegramDb(dataDir);

const queueRepo = createQueueRepository(appDb);
const resourceRepo = createResourceRepository(appDb);
const replyRefs = createTelegramReplyRefsRepository(telegramDb);
const trackRefs = createTelegramTrackRefsRepository(telegramDb);
const users = createTelegramUsersRepository(telegramDb);
const errorLog = createErrorLogRepository(appDb);
const downloader = createYtDlpDownloader();

const enqueueDownload = createEnqueueDownload(queueRepo);
const getUserQueueStatus = createGetUserQueueStatus(queueRepo);

const bot = createBot({
  enqueueDownload,
  replyRefs,
  getUserQueueStatus,
  users,
});

const notifier = createTelegramNotifier({ bot, replyRefs });

const caches: TrackCachePort[] = [];
const archives: TrackStorePort[] = [];
if (config.cacheToChannel) {
  caches.push(
    createTelegramChannelCache({
      bot,
      channelId: config.channelId,
      resource: resourceRepo,
      trackRefs,
      replyRefs,
    })
  );
}
if (config.saveToContentDir) {
  archives.push(createFsCacheAdapter({ contentDir: config.contentDir, resource: resourceRepo }));
}

const processDownloadJob = createProcessDownloadJob({
  queue: queueRepo,
  downloader,
  caches,
  archives,
  notifier,
  errorLog,
  registerPlaylistEntryOrigin: (childJobId, userId) => replyRefs.save(childJobId, userId, null),
});

const recoverStuckJobs = createRecoverStuckJobs({ queue: queueRepo, notifier });
const requeueBlockedJobs = createRequeueBlockedJobs(queueRepo);

await recoverStuckJobs(logger);

// With a PROXY configured, jobs that earlier failed as geo-blocked get another chance.
// Staggered by GEO_REQUEUE_STAGGER_SECONDS (backoffSeconds' own base interval) instead of
// releasing the whole geo-blocked backlog as claimable in one instant — a large backlog
// requeued all at once right at cold start is a plausible OOM amplifier alongside the
// upload double-buffering fixed earlier (see docs/diary/2026-09-06_oom-restart-storm-research.md).
const GEO_REQUEUE_STAGGER_SECONDS = 30;
if (config.proxy) {
  await requeueBlockedJobs({ reason: BlockReason.Geo, staggerSeconds: GEO_REQUEUE_STAGGER_SECONDS });
  logger.info("requeued geo-blocked jobs for retry (proxy is set), staggered to avoid a cold-start burst");
}
startQueuePoller(queueRepo, processDownloadJob);

startHealthServer(config.healthPort);

bot.launch();
logger.bot.info("started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
