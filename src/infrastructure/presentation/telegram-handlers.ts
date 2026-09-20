import type { Telegraf } from "telegraf";
import { message, channelPost } from "telegraf/filters";
import { config } from "../../config";
import { logger } from "../../logger";
import { extractUrls } from "./extract-url";
import { t } from "../localization/t";
import type { EnqueueDownloadFn } from "../../application/enqueue-download";
import type { GetUserQueueStatusFn } from "../../application/get-user-queue-status";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";
import type { TelegramUsersRepository } from "../repository/telegram-users.interfaces";

export interface TelegramHandlersDeps {
  bot: Telegraf;
  enqueueDownload: EnqueueDownloadFn;
  replyRefs: TelegramReplyRefsRepository;
  getUserQueueStatus: GetUserQueueStatusFn;
  users: TelegramUsersRepository;
}

async function isChannelAdmin(bot: Telegraf, userId: number): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(config.channelId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (err) {
    logger.bot.warn(`admin check failed for user ${userId}:`, err);
    return false;
  }
}

export function registerHandlers(deps: TelegramHandlersDeps) {
  const { bot } = deps;

  // listen-channel is a toggle (plan spec): admin turns the channel_post listener on/off.
  // Kept as simple in-memory state — restarts default to "off", matching the original
  // absence of any channel listener at all.
  let listeningEnabled = false;

  bot.start((ctx) => {
    ctx.reply(t("start"));
  });

  bot.command("status", async (ctx) => {
    const counts = await deps.getUserQueueStatus(ctx.from.id);
    const entries = Object.entries(counts);

    if (entries.length === 0) {
      await ctx.reply(t("queue.empty"));
      return;
    }

    await ctx.reply(entries.map(([status, count]) => t("queue.line", { status, count })).join("\n"));
  });

  bot.command("listen_channel", async (ctx) => {
    if (!(await isChannelAdmin(bot, ctx.from.id))) {
      await ctx.reply(t("channel.admin_only"));
      return;
    }
    listeningEnabled = !listeningEnabled;
    await ctx.reply(t(listeningEnabled ? "channel.listening_on" : "channel.listening_off"));
  });

  bot.command("handle_channel_history", async (ctx) => {
    if (!(await isChannelAdmin(bot, ctx.from.id))) {
      await ctx.reply(t("channel.admin_only"));
      return;
    }
    await ctx.reply(t("channel.history_not_implemented"));
  });

  bot.on(message("text"), async (ctx) => {
    const urls = extractUrls(ctx.message.text);
    if (urls.length === 0) {
      await ctx.reply(t("message.no_url"));
      return;
    }

    await deps.users.upsert(ctx.from.id, ctx.from.username ?? null);

    let queued = 0;
    let duplicates = 0;
    for (const url of urls) {
      const result = await deps.enqueueDownload({ url, userId: ctx.from.id });
      if (result.status === "duplicate") {
        duplicates++;
        continue;
      }
      queued++;
      await deps.replyRefs.save(result.jobId, ctx.chat.id, ctx.message.message_id);
    }

    if (urls.length === 1) {
      await ctx.reply(t(duplicates === 1 ? "message.duplicate" : "message.queued"));
      return;
    }
    await ctx.reply(
      duplicates > 0 ? t("message.queued_many_with_duplicates", { queued, duplicates }) : t("message.queued_many", { queued }),
    );
  });

  bot.on(channelPost(), async (ctx) => {
    if (!listeningEnabled) return;

    const post = ctx.channelPost;

    // Own bot replies (uploaded files forwarded/sent by this bot) always have
    // reply_to_message set in the private channel — filters them out reliably even if a
    // caption happens to contain a URL.
    if ("reply_to_message" in post && post.reply_to_message) return;

    const text = "text" in post ? post.text : "caption" in post ? post.caption : undefined;
    if (!text) return;

    const urls = extractUrls(text);
    if (urls.length === 0) return;

    // Channel posts have no `.from` in the Bot API (only regular chat messages do) — use
    // the channel's own id as a placeholder; what actually matters for delivery is the
    // reply-ref (chatId=channel, messageId=post) saved below.
    const userId = Number(config.channelId);
    for (const url of urls) {
      const result = await deps.enqueueDownload({ url, userId });
      if (result.status === "duplicate") continue;
      await deps.replyRefs.save(result.jobId, ctx.chat.id, post.message_id);
    }
  });
}
