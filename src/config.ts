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
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
  workerIntervalMs: 5_000,
  maxFileSizeBytes: 50 * 1024 * 1024, // 50MB Telegram limit
};
