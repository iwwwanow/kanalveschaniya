import { config } from "../config";

// Bypasses Telegraf's own HTTP client (fs.createReadStream + multipart-stream,
// piped through Bun's Node-compat fetch shim) for file uploads specifically.
// That path streams the request body with no known Content-Length, and Bun's
// fetch drops the connection mid-transfer when tunneled through an HTTP CONNECT
// proxy on files this size (confirmed via curl: same file, same proxy, no proxy
// issue — completes in ~10s). A Blob-backed FormData has a known length, so Bun
// sends it as a normal request instead of chunked, matching curl's behavior.
//
// This also sidesteps a telegraf/Bun bug where telegraf's own error handler
// (redactToken) crashes the whole process with "Attempted to assign to readonly
// property" when the underlying fetch error's `message` isn't writable.

interface SendMediaResult {
  messageId: number;
}

export async function sendMedia(opts: {
  chatId: number | string;
  buffer: Buffer;
  filename: string;
  isVideo: boolean;
  caption?: string;
  duration?: number;
  title?: string;
}): Promise<SendMediaResult> {
  const method = opts.isVideo ? "sendVideo" : "sendAudio";
  const field = opts.isVideo ? "video" : "audio";
  const mimeType = opts.isVideo ? "video/mp4" : "audio/mpeg";

  const form = new FormData();
  form.append("chat_id", String(opts.chatId));
  form.append(field, new Blob([opts.buffer], { type: mimeType }), opts.filename);
  if (opts.caption) form.append("caption", opts.caption);
  if (opts.duration) form.append("duration", String(opts.duration));
  if (!opts.isVideo && opts.title) form.append("title", opts.title);

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST",
    body: form,
  });

  const data = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!data.ok || !data.result) {
    throw new Error(`${method} failed: ${data.description ?? res.status}`);
  }
  return { messageId: data.result.message_id };
}
