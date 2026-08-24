import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "./logger";
import { config } from "./config";
import { openAppDb } from "./infra/db/app-db";
import { openTelegramDb } from "./infra/db/telegram-db";
import { migrateLegacyDb } from "./infra/db/migrate-legacy";
import { createQueueRepository } from "./infra/repository/queue-repository";
import { createResourceRepository } from "./infra/repository/resource-repository";
import { createTelegramReplyRefsRepository } from "./infra/repository/telegram-reply-refs";
import { createTelegramTrackRefsRepository } from "./infra/repository/telegram-track-refs";
import { createYtDlpDownloader, requeueGeoBlockedIfProxyAvailable } from "./infra/adapters/yt-dlp";
import { createTelegramNotifier } from "./infra/adapters/telegram-notifier";
import { createTelegramChannelCache } from "./infra/adapters/telegram-channel-cache";
import { createFsCacheAdapter } from "./infra/adapters/fs-cache-adapter";
import type { TrackStorePort } from "./domain/track-cache";
import { createEnqueueDownload } from "./application/enqueue-download";
import { createProcessDownloadJob } from "./application/process-download-job";
import { createBot } from "./infra/presentation/telegram-bot";
import { startQueuePoller } from "./infra/workers/queue-poller";

// DATA_DIR handling preserved as-is (read directly, not via config.ts) — now resolves
// app.db + telegram.db + a possible legacy bot.db in the same directory.
const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "../data");
mkdirSync(dataDir, { recursive: true });

// Must be checked BEFORE openAppDb() — bun:sqlite creates the file on open with
// {create:true}, so checking after opening would always report "already existed".
const appDbAlreadyExisted = existsSync(join(dataDir, "app.db"));

const appDb = openAppDb(dataDir);
const telegramDb = openTelegramDb(dataDir);

migrateLegacyDb({ dataDir, appDb, telegramDb, appDbAlreadyExisted });

const queueRepo = createQueueRepository(appDb);
const resourceRepo = createResourceRepository(appDb);
const replyRefs = createTelegramReplyRefsRepository(telegramDb);
const trackRefs = createTelegramTrackRefsRepository(telegramDb);
const downloader = createYtDlpDownloader();

const enqueueDownload = createEnqueueDownload(queueRepo);

const bot = createBot({
  enqueueDownload,
  replyRefs,
  queue: queueRepo,
  telegramDb,
});

const notifier = createTelegramNotifier({ bot, replyRefs });

const stores: TrackStorePort[] = [];
if (config.cacheToChannel) {
  stores.push(
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
  stores.push(createFsCacheAdapter({ contentDir: config.contentDir, resource: resourceRepo }));
}

const processDownloadJob = createProcessDownloadJob({
  queue: queueRepo,
  downloader,
  stores,
  notifier,
  appDb,
  registerPlaylistEntryOrigin: (childJobId, userId) => replyRefs.save(childJobId, userId, null),
});

await requeueGeoBlockedIfProxyAvailable(queueRepo);
startQueuePoller(queueRepo, processDownloadJob);

bot.launch();
logger.bot.info("started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
