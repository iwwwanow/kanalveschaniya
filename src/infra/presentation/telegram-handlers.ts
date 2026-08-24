import type { Telegraf } from "telegraf";
import { message, channelPost } from "telegraf/filters";
import type { Database } from "bun:sqlite";
import { config } from "../../config";
import { logger } from "../../logger";
import { extractUrl } from "./extract-url";
import type { EnqueueDownloadFn } from "../../application/enqueue-download";
import type { QueueRepository } from "../../domain/queue";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";

export interface TelegramHandlersDeps {
  bot: Telegraf;
  enqueueDownload: EnqueueDownloadFn;
  replyRefs: TelegramReplyRefsRepository;
  queue: QueueRepository;
  // users upsert is plain SQL against telegram.db, in presentation — plan decision #1
  // (users isn't a domain table, no Repository/Port wrapper).
  telegramDb: Database;
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

function upsertUser(telegramDb: Database, userId: number, username: string | null) {
  telegramDb.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [userId, username]);
}

export function registerHandlers(deps: TelegramHandlersDeps) {
  const { bot } = deps;

  // listen-channel is a toggle (plan spec): admin turns the channel_post listener on/off.
  // Kept as simple in-memory state — restarts default to "off", matching the original
  // absence of any channel listener at all.
  let listeningEnabled = false;

  bot.start((ctx) => {
    ctx.reply(
      "Привет! Отправь мне ссылку на трек или плейлист (SoundCloud, YouTube, Bandcamp и др.) и я скачаю его для тебя."
    );
  });

  bot.command("status", async (ctx) => {
    const counts = await deps.queue.countByStatusForUser(ctx.from.id);
    const entries = Object.entries(counts);

    if (entries.length === 0) {
      await ctx.reply("Очередь пуста");
      return;
    }

    await ctx.reply(entries.map(([status, count]) => `${status}: ${count}`).join("\n"));
  });

  bot.command("listen_channel", async (ctx) => {
    if (!(await isChannelAdmin(bot, ctx.from.id))) {
      await ctx.reply("Команда доступна только администраторам канала");
      return;
    }
    listeningEnabled = !listeningEnabled;
    await ctx.reply(listeningEnabled ? "Слушаю канал" : "Больше не слушаю канал");
  });

  bot.command("handle_channel_history", async (ctx) => {
    if (!(await isChannelAdmin(bot, ctx.from.id))) {
      await ctx.reply("Команда доступна только администраторам канала");
      return;
    }
    await ctx.reply("Пока не реализовано — нужен MTProto-клиент (userbot) для чтения истории канала.");
  });

  bot.on(message("text"), async (ctx) => {
    const url = extractUrl(ctx.message.text);
    if (!url) {
      await ctx.reply("Отправь ссылку на трек или плейлист");
      return;
    }

    upsertUser(deps.telegramDb, ctx.from.id, ctx.from.username ?? null);

    const result = await deps.enqueueDownload({ url, userId: ctx.from.id });

    if (result.status === "duplicate") {
      await ctx.reply("Уже в очереди");
      return;
    }

    await deps.replyRefs.save(result.jobId, ctx.chat.id, ctx.message.message_id);
    await ctx.reply("Добавлено в очередь");
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

    const url = extractUrl(text);
    if (!url) return;

    // Channel posts have no `.from` in the Bot API (only regular chat messages do) — use
    // the channel's own id as a placeholder; what actually matters for delivery is the
    // reply-ref (chatId=channel, messageId=post) saved below.
    const userId = Number(config.channelId);
    const result = await deps.enqueueDownload({ url, userId });

    if (result.status === "duplicate") return;

    await deps.replyRefs.save(result.jobId, ctx.chat.id, post.message_id);
  });
}
