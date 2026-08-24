import type { Telegraf } from "telegraf";
import { readFile } from "fs/promises";
import { basename } from "path";
import type { Track, ResourceRepository } from "../../domain/resource";
import type { TrackCachePort } from "../../domain/track-cache";
import type { TelegramTrackRefsRepository } from "../repository/telegram-track-refs.interfaces";
import type { TelegramReplyRefsRepository } from "../repository/telegram-reply-refs.interfaces";
import { sendMedia } from "./telegram-send-media";

export interface TelegramChannelCacheDeps {
  bot: Telegraf;
  channelId: string;
  resource: ResourceRepository;
  trackRefs: TelegramTrackRefsRepository;
  replyRefs: TelegramReplyRefsRepository;
}

export function createTelegramChannelCache(deps: TelegramChannelCacheDeps): TrackCachePort {
  return {
    async find(trackId) {
      // Backend-proof first: resource — общая метаданных-таблица, её может писать и
      // другой TrackStorePort (например fs). Наличие строки там ничего не говорит о
      // том, есть ли трек именно в этом канале — без этой проверки deliver() ниже
      // упал бы на треке, закэшированном только в другом сторе.
      const ref = await deps.trackRefs.get(trackId);
      if (!ref) return null;
      return deps.resource.findByTrackId(trackId);
    },

    async save(track: Track, filePath: string) {
      // isVideo is derived from the file extension rather than stored on the domain
      // Track — nothing in domain/application needs to know audio vs video, only the
      // upload step does (see final report for rationale).
      const isVideo = filePath.endsWith(".mp4");
      const buffer = await readFile(filePath);

      const { messageId } = await sendMedia({
        chatId: deps.channelId,
        buffer,
        filename: basename(filePath),
        isVideo,
        caption: track.title,
        duration: track.duration || undefined,
        title: track.title,
      });

      await deps.resource.save(track);
      await deps.trackRefs.save(track.trackId, messageId);
    },

    async deliver(track, jobId) {
      const ref = await deps.trackRefs.get(track.trackId);
      if (!ref) {
        throw new Error(`No channel ref for track ${track.trackId}`);
      }

      const target = await deps.replyRefs.get(jobId);
      if (!target) {
        throw new Error(`No reply target for job ${jobId}`);
      }

      await deps.bot.telegram.forwardMessage(target.chatId, deps.channelId, ref.channelMessageId);
    },
  };
}
