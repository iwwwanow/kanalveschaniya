import type { Telegraf } from "telegraf";
import { readFile } from "fs/promises";
import { basename } from "path";
import type { DownloadResult } from "../../domain/download";
import type { NotifierPort } from "../../domain/notifier";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";
import { sendMedia } from "./telegram-send-media";

export interface TelegramNotifierDeps {
  bot: Telegraf;
  replyRefs: TelegramReplyRefsRepository;
}

type FailureResult = Extract<DownloadResult, { ok: false }>;

// blockReason is opaque to domain/application (see docs/specs/types.md) — this is infra,
// so it's free to give the opaque string real meaning for user-facing text.
function formatFailureMessage(result: FailureResult): string {
	// is it error from yt-dlp adapter constants?
  if (result.blockReason === "geo") {
    return "Трек недоступен из-за гео-ограничения.\nБудет загружен автоматически при настройке прокси.";
  }
  if (result.blockReason === "drm") {
    return "Трек защищён DRM, скачивание невозможно.";
  }
  if (result.blockReason === "too_large") {
    return result.error;
  }
  if (result.error.includes("HTTP Error 404")) {
    return "Не удалось загрузить: трек не найден (404).";
  }
  return "Не удалось загрузить трек: превышено число попыток.";
}

export function createTelegramNotifier(deps: TelegramNotifierDeps): NotifierPort {
  return {
    async notify(jobId, result) {
      const ref = await deps.replyRefs.get(jobId);
      if (!ref) return;

      const extra = ref.messageId != null ? { reply_parameters: { message_id: ref.messageId } } : undefined;

      if (result.ok) {
        // Only called when caching is disabled (CACHE_TO_CHANNEL=false) — when caching is
        // enabled, TrackCachePort.deliver() already handled delivery (plan decision #5).
        const isVideo = result.filePath.endsWith(".mp4");
        const buffer = await readFile(result.filePath);
        await sendMedia({
          chatId: ref.chatId,
          buffer,
          filename: basename(result.filePath),
          isVideo,
          caption: result.track.title,
          duration: result.track.duration || undefined,
          title: result.track.title,
        });
        return;
      }

      await deps.bot.telegram.sendMessage(ref.chatId, formatFailureMessage(result), extra);
    },

    async notifyPlaylistQueued(jobId, summary) {
      const ref = await deps.replyRefs.get(jobId);
      if (!ref) return;

      const extra = ref.messageId != null ? { reply_parameters: { message_id: ref.messageId } } : undefined;
      await deps.bot.telegram.sendMessage(
        ref.chatId,
        `Плейлист: ${summary.queued} в очереди, ${summary.cached} уже в кэше`,
        extra
      );
    },
  };
}
