// Incident 2026-09-23: the bot token was printed verbatim into the container logs on Pi.
// Every Bot API call goes to https://api.telegram.org/bot<TOKEN>/<method>, and Bun's fetch
// attaches that whole URL to its network errors (`path` field) — Bun's default error printer
// dumps it, and telegraf's own redactToken only rewrites `error.message`, so the URL in `path`
// survived. Everything that reaches the logs (and error_log / queue.error) goes through redact()
// so a token can't ride along with an error object again.
//
// No imports on purpose: config.ts throws when BOT_TOKEN is unset, and this module has to stay
// usable from the application layer and from tests. The live token is handed over at boot with
// registerSecret().

// A Telegram token is <bot_id>:<~35 url-safe chars>. Matched with or without the bot/user prefix
// that the API path carries, so a token logged on its own is caught too.
const TOKEN_PATTERN = /\b(bot|user)?(\d{5,}):[A-Za-z0-9_-]{20,}/g;

const secrets = new Set<string>();

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Register an exact secret (the bot token) to be masked wherever it appears in a log line. */
export function registerSecret(secret: string): void {
  if (secret.length >= 8) secrets.add(secret);
}

export function redact(text: string): string {
  let out = text.replace(TOKEN_PATTERN, (_match, prefix: string | undefined, id: string) => `${prefix ?? ""}${id}:[REDACTED]`);
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeForRegExp(secret), "g"), "[REDACTED]");
  }
  return out;
}

/**
 * One-line description of a thrown value. Bun's fetch errors have no stack and an unhelpful
 * message ("Unable to connect. Is the computer able to access the url?"), so the `code`
 * (ECONNRESET, ConnectionRefused, …) is appended — it is what actually identifies the failure.
 * The URL-bearing `path` field is deliberately left out.
 */
export function describeError(value: unknown): string {
  if (!(value instanceof Error)) return redact(String(value));
  const code = (value as { code?: unknown }).code;
  const suffix = typeof code === "string" || typeof code === "number" ? ` (code=${code})` : "";
  return redact(`${value.name}: ${value.message}${suffix}`);
}
