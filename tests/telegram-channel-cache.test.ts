import { describe, expect, test } from "bun:test";
import type { Resource } from "../src/domain/resource";

// telegram-channel-cache -> send-media -> config insists on these; the values are never used.
process.env.BOT_TOKEN ??= "test-token";
process.env.CHANNEL_ID ??= "-1";
const { createTelegramChannelCache } = await import("../src/infrastructure/adapters/telegram-channel-cache");

const CHANNEL = "-1001234567890";
const resource: Resource = { resourceId: "r1", url: "http://x/r1", title: "T", duration: 10 };

function setup(replyRef: { chatId: number; messageId: number | null } | null, opts: { forwardFails?: boolean } = {}) {
  const events: string[] = [];
  const cache = createTelegramChannelCache({
    bot: {
      telegram: {
        forwardMessage: async (to: string | number, from: string | number, messageId: number) => {
          events.push(`forward ${to} <- ${from}#${messageId}`);
          if (opts.forwardFails) throw new Error("Bad Request: message can't be forwarded");
        },
      },
    } as any,
    channelId: CHANNEL,
    resource: { findByResourceId: async () => null, save: async () => void events.push("resource.save") },
    resourceRefs: { get: async () => null, save: async () => void events.push("refs.save") } as any,
    replyRefs: { get: async () => (replyRef ? { jobId: 1, ...replyRef } : null), save: async () => {} },
    sendMedia: async () => {
      events.push("upload");
      return { messageId: 900 };
    },
  });
  return { cache, events };
}

describe("telegram-channel-cache.save: original message", () => {
  test("uploads the file, then forwards the user's original message into the channel", async () => {
    const { cache, events } = setup({ chatId: 555, messageId: 42 });
    await cache.save(resource, "/tmp/a.mp3", 1);

    expect(events).toEqual(["upload", "resource.save", "refs.save", `forward ${CHANNEL} <- 555#42`]);
  });

  test("nothing to forward: playlist entries (no message), posts from the channel itself, unknown job", async () => {
    for (const ref of [{ chatId: 555, messageId: null }, { chatId: Number(CHANNEL), messageId: 7 }, null]) {
      const { cache, events } = setup(ref);
      await cache.save(resource, "/tmp/a.mp3", 1);
      expect(events.some((e) => e.startsWith("forward"))).toBe(false);
    }
  });

  test("a failing forward never fails the save (it would retry the whole job)", async () => {
    const { cache, events } = setup({ chatId: 555, messageId: 42 }, { forwardFails: true });
    await expect(cache.save(resource, "/tmp/a.mp3", 1)).resolves.toBeUndefined();
    expect(events).toContain("refs.save"); // the file itself was stored before the forward was tried
  });
});

