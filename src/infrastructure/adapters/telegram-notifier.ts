import type { Telegraf } from "telegraf";
import { basename } from "path";
import type { DownloadResult } from "../../domain/download";
import type { NotifierPort } from "../../domain/notifier";
import { BlockReason } from "../../domain/block-reason";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";
import { sendMedia } from "./telegram-client/send-media";

export interface TelegramNotifierDeps {
  bot: Telegraf;
  replyRefs: TelegramReplyRefsRepository;
}

type FailureResult = Extract<DownloadResult, { ok: false }>;

// Exhaustive over BlockReason — adding a reason without a user-facing text fails typecheck.
const BLOCK_REASON_MESSAGES: Record<BlockReason, (result: FailureResult) => string> = {
  [BlockReason.Geo]: () =>
    "Трек недоступен из-за гео-ограничения.\nБудет загружен автоматически при настройке прокси.",
  [BlockReason.Drm]: () => "Трек защищён DRM, скачивание невозможно.",
  [BlockReason.TooLarge]: (result) => result.error,
  [BlockReason.CrashedRepeatedly]: () =>
    "Не удалось загрузить трек — скачивание несколько раз подряд приводило к сбою (вероятно, трек слишком большой/длинный).",
};

function formatFailureMessage(result: FailureResult): string {
  if (result.blockReason) return BLOCK_REASON_MESSAGES[result.blockReason](result);
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
        // enabled, ResourceCachePort.deliver() already handled delivery (plan decision #5).
        const isVideo = result.filePath.endsWith(".mp4");
        await sendMedia({
          chatId: ref.chatId,
          filePath: result.filePath,
          filename: basename(result.filePath),
          isVideo,
          caption: result.resource.title,
          duration: result.resource.duration || undefined,
          title: result.resource.title,
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
