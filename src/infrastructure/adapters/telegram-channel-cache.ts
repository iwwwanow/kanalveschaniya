import type { Telegraf } from "telegraf";
import { basename } from "path";
import type { Resource, ResourceRepository } from "../../domain/resource";
import type { ResourceCachePort } from "../../domain/resource-cache";
import type { TelegramResourceRefsRepository } from "../repository/telegram-resource-refs.interfaces";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";
import { sendMedia as defaultSendMedia } from "./telegram-client/send-media";
import { logger } from "../../logger";

export interface TelegramChannelCacheDeps {
  bot: Telegraf;
  channelId: string;
  resource: ResourceRepository;
  resourceRefs: TelegramResourceRefsRepository;
  replyRefs: TelegramReplyRefsRepository;
  // Injectable for tests; the real upload by default.
  sendMedia?: typeof defaultSendMedia;
}

export function createTelegramChannelCache(deps: TelegramChannelCacheDeps): ResourceCachePort {
  const sendMedia = deps.sendMedia ?? defaultSendMedia;

  // The channel keeps the context of a track: the user's original message goes in right after
  // the file. Best-effort — a failed forward must not fail (and so retry) the job.
  async function forwardOriginalMessage(jobId: number): Promise<void> {
    try {
      const ref = await deps.replyRefs.get(jobId);
      // no message: playlist entries; same chat: a post that already lives in the channel
      if (!ref || ref.messageId == null || String(ref.chatId) === deps.channelId) return;
      await deps.bot.telegram.forwardMessage(deps.channelId, ref.chatId, ref.messageId);
    } catch (err) {
      logger.warn(`job ${jobId} | forwarding the original message to the channel failed:`, err);
    }
  }

  return {
    name: "channel",

    async find(resourceId) {
      // Backend-proof first: resource — общая метаданных-таблица, её может писать и
      // другой ResourceStorePort (например fs). Наличие строки там ничего не говорит о
      // том, есть ли трек именно в этом канале — без этой проверки deliver() ниже
      // упал бы на треке, закэшированном только в другом сторе.
      const ref = await deps.resourceRefs.get(resourceId);
      if (!ref) return null;
      return deps.resource.findByResourceId(resourceId);
    },

    async save(resource, filePath, jobId) {
      // isVideo is derived from the file extension rather than stored on the domain
      // Resource — nothing in domain/application needs to know audio vs video, only the
      // upload step does (see final report for rationale).
      const isVideo = filePath.endsWith(".mp4");

      const { messageId } = await sendMedia({
        chatId: deps.channelId,
        filePath,
        filename: basename(filePath),
        isVideo,
        caption: resource.title,
        duration: resource.duration || undefined,
        title: resource.title,
      });

      await deps.resource.save(resource);
      await deps.resourceRefs.save(resource.resourceId, messageId);

      await forwardOriginalMessage(jobId);
    },

    async deliver(resource, jobId) {
      const ref = await deps.resourceRefs.get(resource.resourceId);
      if (!ref) {
        throw new Error(`No channel ref for resource ${resource.resourceId}`);
      }

      const target = await deps.replyRefs.get(jobId);
      if (!target) {
        throw new Error(`No reply target for job ${jobId}`);
      }

      await deps.bot.telegram.forwardMessage(target.chatId, deps.channelId, ref.channelMessageId);
    },
  };
}
