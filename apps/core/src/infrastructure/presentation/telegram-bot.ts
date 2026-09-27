import { Telegraf, TelegramError } from "telegraf";
import { config } from "../../config";
import { logger } from "../../logger";
import { registerHandlers, type TelegramHandlersDeps } from "./telegram-handlers";

export function createBot(deps: Omit<TelegramHandlersDeps, "bot">): Telegraf {
  const bot = new Telegraf(config.botToken);
  registerHandlers({ bot, ...deps });
  // Telegraf's default error handler sets process.exitCode = 1 and rethrows, which tears down the
  // polling loop over one failed reply (a user who blocked the bot, a deleted chat). A handler
  // error is logged and the update dropped; the queue keeps its own retry/failure lifecycle.
  bot.catch((err, ctx) => {
    logger.bot.error(`handler error on update ${ctx.update.update_id}:`, err);
  });
  return bot;
}

export interface BotRunner {
  /** Stop polling for good — no relaunch after this. */
  stop(reason: string): void;
}

const RELAUNCH_DELAY_MS = 5_000;

// Incident 2026-09-23 (8 pod restarts, exit code 1): an ECONNRESET on getUpdates killed the
// process. Telegraf's polling loop retries a failed getUpdates only when `err.name === "FetchError"`
// (node_modules/telegraf/lib/core/network/polling.js), but Bun shims node-fetch with its native
// fetch, whose network errors are plain `Error` with `code: "ECONNRESET"` — so the error escaped
// the loop, out of the un-awaited bot.launch(), and became a fatal unhandled rejection.
// Kubernetes restarted the pod each time; here polling is restarted in-process instead.
export function startBot(bot: Telegraf): BotRunner {
  let stopping = false;

  void (async () => {
    while (!stopping) {
      try {
        // Resolves only when polling stops (bot.stop) — otherwise it runs for the process' life.
        await bot.launch();
        return;
      } catch (err) {
        // 401 means the token is wrong or revoked: retrying can't fix it, and a crash-looping pod
        // is the visible signal. Everything else (resets, timeouts, 5xx, 409 during a rollout)
        // is transient — log it and poll again.
        if (err instanceof TelegramError && err.code === 401) {
          logger.bot.error("unauthorized — check BOT_TOKEN:", err);
          process.exit(1);
        }
        logger.bot.warn(`polling failed, restarting in ${RELAUNCH_DELAY_MS / 1000}s:`, err);
        await Bun.sleep(RELAUNCH_DELAY_MS);
      }
    }
  })();

  return {
    stop(reason: string) {
      stopping = true;
      try {
        bot.stop(reason);
      } catch {
        // "Bot is not running!" — launch hadn't started polling yet; `stopping` already blocks it.
      }
    },
  };
}
