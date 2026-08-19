const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

export const config = {
  botToken: required("BOT_TOKEN"),
  channelId: required("CHANNEL_ID"),
  proxy: process.env.PROXY,
  tmpDir: process.env.TMP_DIR ?? "/tmp/ytdlp",
  contentDir: process.env.CONTENT_DIR ?? "./content",
  cacheToChannel: process.env.CACHE_TO_CHANNEL !== "false",
  saveToContentDir: process.env.SAVE_TO_CONTENT_DIR !== "false",
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
  workerIntervalMs: 5_000,
  maxFileSizeBytes: 50 * 1024 * 1024, // 50MB Telegram limit
};

if (!config.cacheToChannel && !config.saveToContentDir) {
  throw new Error("At least one of CACHE_TO_CHANNEL or SAVE_TO_CONTENT_DIR must be true — media has to be stored somewhere");
}
