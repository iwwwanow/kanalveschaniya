import { describe, expect, test } from "bun:test";
import { describeError, redact, registerSecret } from "../src/redact";

const TOKEN = "123456789:AAH3k2LqZ9xWv-QrS_tUvWxYz01234567_8";

describe("redact", () => {
  test("masks a token inside a Bot API url", () => {
    const out = redact(`request to https://api.telegram.org/bot${TOKEN}/getUpdates failed`);
    expect(out).toBe("request to https://api.telegram.org/bot123456789:[REDACTED]/getUpdates failed");
    expect(out).not.toContain(TOKEN);
  });

  test("masks a bare token with no bot/ prefix", () => {
    expect(redact(`BOT_TOKEN=${TOKEN}`)).toBe("BOT_TOKEN=123456789:[REDACTED]");
  });

  test("masks every occurrence", () => {
    const out = redact(`${TOKEN} and again ${TOKEN}`);
    expect(out).not.toContain(TOKEN);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  test("leaves ordinary text alone", () => {
    const line = "job 42 | https://soundcloud.com/x/y | duration=1:23 | resource_id=abc";
    expect(redact(line)).toBe(line);
  });

  test("masks a registered secret that the pattern would miss", () => {
    const odd = "not-a-telegram-shaped-token-value";
    registerSecret(odd);
    expect(redact(`token is ${odd}`)).toBe("token is [REDACTED]");
  });
});

describe("describeError", () => {
  test("keeps the code and drops the url-bearing path of a Bun fetch error", () => {
    // Shape produced by Bun's native fetch (which also backs node-fetch under Bun): no stack,
    // vague message, request url in `path`.
    const err = Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), {
      code: "ECONNRESET",
      path: `https://api.telegram.org/bot${TOKEN}/getUpdates`,
      errno: 0,
    });
    const out = describeError(err);
    expect(out).toBe("Error: Unable to connect. Is the computer able to access the url? (code=ECONNRESET)");
    expect(out).not.toContain(TOKEN);
  });

  test("redacts a token that leaked into the message", () => {
    const err = new Error(`request to https://api.telegram.org/bot${TOKEN}/sendAudio failed`);
    expect(describeError(err)).not.toContain(TOKEN);
  });

  test("stringifies a non-Error throw", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(undefined)).toBe("undefined");
  });
});
