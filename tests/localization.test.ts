import { describe, expect, test } from "bun:test";
import { BlockReason } from "../src/domain/block-reason";
import texts from "../src/infrastructure/localization/telegram.localization.json";
import { TEXT_PARAMS, assertTextsValid, t, type TextKey } from "../src/infrastructure/localization/t";

// The notifier pulls in send-media -> config, which insists on these; the values are never used.
process.env.BOT_TOKEN ??= "test-token";
process.env.CHANNEL_ID ??= "-1";
const { createTelegramNotifier } = await import("../src/infrastructure/adapters/telegram-notifier");

describe("telegram.localization.json", () => {
  test("every text passes startup validation (no empty texts, no unknown placeholders)", () => {
    expect(() => assertTextsValid()).not.toThrow();
  });

  test("TEXT_PARAMS and the JSON declare the same keys", () => {
    expect(Object.keys(TEXT_PARAMS).sort()).toEqual(Object.keys(texts).sort());
  });

  test("every key renders when all its parameters are given, leaving no {placeholder} behind", () => {
    for (const key of Object.keys(TEXT_PARAMS) as TextKey[]) {
      const params = Object.fromEntries(TEXT_PARAMS[key].map((name) => [name, "X"]));
      expect(t(key, params)).not.toMatch(/\{\w+\}/);
    }
  });

  test("a missing parameter is an error, an extra one is ignored", () => {
    expect(() => t("queue.line", { status: "done" })).toThrow('no value for {count}');
    expect(t("queue.empty", { unused: 1 })).toBe(texts["queue.empty"]);
  });
});

describe("telegram-notifier failure texts", () => {
  function capture() {
    const sent: string[] = [];
    const notifier = createTelegramNotifier({
      bot: { telegram: { sendMessage: async (_chat: number, text: string) => void sent.push(text) } } as any,
      replyRefs: { get: async () => ({ jobId: 1, chatId: 1, messageId: null }), save: async () => {} },
      maxFileSizeBytes: 50 * 1024 * 1024,
    });
    return { sent, notifier };
  }

  test("every BlockReason has a user-facing text", async () => {
    for (const blockReason of Object.values(BlockReason)) {
      const { sent, notifier } = capture();
      await notifier.notify(1, { ok: false, error: "e", retryable: false, blockReason });
      expect(sent[0]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("too_large text names the track and the limit", async () => {
    const { sent, notifier } = capture();
    await notifier.notify(1, {
      ok: false,
      error: "technical",
      retryable: false,
      blockReason: BlockReason.TooLarge,
      resource: { resourceId: "r", url: "u", title: "Mix", duration: 1 },
    });
    expect(sent[0]).toContain("Mix");
    expect(sent[0]).toContain("50");
  });

  test("404 and unknown failures use their own texts", async () => {
    const a = capture();
    await a.notifier.notify(1, { ok: false, error: "HTTP Error 404: Not Found", retryable: false });
    expect(a.sent[0]).toBe(t("failure.not_found"));
    const b = capture();
    await b.notifier.notify(1, { ok: false, error: "boom", retryable: false });
    expect(b.sent[0]).toBe(t("failure.generic"));
  });
});
