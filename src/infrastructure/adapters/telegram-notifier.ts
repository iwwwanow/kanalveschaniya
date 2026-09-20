import type { Telegraf } from "telegraf";
import { basename } from "path";
import type { DownloadResult } from "../../domain/download";
import type { NotifierPort } from "../../domain/notifier";
import { BlockReason } from "../../domain/block-reason";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";
import { sendMedia } from "./telegram-client/send-media";
import { t, type TextKey } from "../localization/t";

export interface TelegramNotifierDeps {
  bot: Telegraf;
  replyRefs: TelegramReplyRefsRepository;
  // Upload limit shown in the too_large text.
  maxFileSizeBytes: number;
}

type FailureResult = Extract<DownloadResult, { ok: false }>;

// Exhaustive over BlockReason — adding a reason without a text key fails typecheck.
const BLOCK_REASON_TEXT: Record<BlockReason, TextKey> = {
  [BlockReason.Geo]: "failure.geo",
  [BlockReason.Drm]: "failure.drm",
  [BlockReason.TooLarge]: "failure.too_large",
  [BlockReason.CrashedRepeatedly]: "failure.crashed_repeatedly",
};

function formatFailureMessage(result: FailureResult, maxFileSizeBytes: number): string {
  if (result.blockReason) {
    return t(BLOCK_REASON_TEXT[result.blockReason], {
      title: result.resource?.title ?? "",
      limit_mb: Math.round(maxFileSizeBytes / 1024 / 1024),
    });
  }
  if (result.error.includes("HTTP Error 404")) return t("failure.not_found");
  return t("failure.generic");
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

      await deps.bot.telegram.sendMessage(ref.chatId, formatFailureMessage(result, deps.maxFileSizeBytes), extra);
    },

    async notifyPlaylistQueued(jobId, summary) {
      const ref = await deps.replyRefs.get(jobId);
      if (!ref) return;

      const extra = ref.messageId != null ? { reply_parameters: { message_id: ref.messageId } } : undefined;
      await deps.bot.telegram.sendMessage(
        ref.chatId,
        t("playlist.queued", { queued: summary.queued, cached: summary.cached }),
        extra
      );
    },
  };
}
