import type { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { db } from "../db";

interface TrackRow {
  channel_message_id: number;
}

function isUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function registerHandlers(bot: Telegraf, channelId: string) {
  bot.start((ctx) => {
    ctx.reply(
      "Привет! Отправь мне ссылку на трек или плейлист (SoundCloud, YouTube, Bandcamp и др.) и я скачаю его для тебя."
    );
  });

  bot.command("status", (ctx) => {
    const rows = db
      .query<{ status: string; count: number }, [number]>(
        `SELECT status, COUNT(*) as count FROM queue WHERE user_id = ? GROUP BY status`
      )
      .all(ctx.from.id);

    if (rows.length === 0) {
      return ctx.reply("Очередь пуста");
    }

    const lines = rows.map((r) => `${r.status}: ${r.count}`);
    ctx.reply(lines.join("\n"));
  });

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text.trim();

    if (!isUrl(text)) {
      return ctx.reply("Отправь ссылку на трек или плейлист");
    }

    const userId = ctx.from.id;
    const username = ctx.from.username ?? null;

    // Upsert user
    db.run(
      `INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`,
      [userId, username]
    );

    // Check cache by URL (exact match for single tracks)
    const cached = db
      .query<TrackRow, [string]>(
        `SELECT channel_message_id FROM tracks WHERE url = ?`
      )
      .get(text);

    if (cached) {
      await ctx.reply("Уже есть, пересылаю...");
      await ctx.telegram.forwardMessage(userId, channelId, cached.channel_message_id);
      return;
    }

    // Check if already queued
    const existing = db
      .query<{ id: number }, [string]>(
        `SELECT id FROM queue WHERE url = ? AND status IN ('pending', 'processing')`
      )
      .get(text);

    if (existing) {
      return ctx.reply("Уже в очереди");
    }

    db.run(`INSERT INTO queue (url, user_id) VALUES (?, ?)`, [text, userId]);
    ctx.reply("Добавлено в очередь");
  });
}
