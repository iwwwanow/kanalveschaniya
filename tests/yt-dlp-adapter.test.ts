import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { BlockReason } from "../src/domain/block-reason";
import { tmpDir } from "./helpers";

// A fake `yt-dlp` (YT_DLP_PATH points to it): `-J` prints metadata with the duration from the `duration`
// file (Bun's child processes don't see later process.env changes); any other call
// (the actual download) drops a marker file and fails. So the test sees whether a download started.
const bin = tmpDir("kv-bin-");
const marker = join(bin, "download-started");
const setDuration = (seconds: number) => writeFileSync(join(bin, "duration"), String(seconds));
writeFileSync(
  join(bin, "yt-dlp"),
  `#!/bin/sh
DURATION=$(cat "${bin}/duration")
case "$*" in
  *" -J "*|"-J "*) echo "{\\"id\\":\\"m1\\",\\"title\\":\\"Mix\\",\\"duration\\":$DURATION,\\"webpage_url\\":\\"http://x/m1\\"}" ;;
  *) touch "${marker}"; echo "boom" >&2; exit 1 ;;
esac
`,
);
chmodSync(join(bin, "yt-dlp"), 0o755);

// `config` is one module for the whole `bun test` process (other test files may have loaded it
// already), so override its fields instead of relying on env vars read at import time.
process.env.BOT_TOKEN ??= "test-token";
process.env.CHANNEL_ID ??= "-1";
const { config } = await import("../src/config");
const original = { ytDlpPath: config.ytDlpPath, tmpDir: config.tmpDir };
config.ytDlpPath = join(bin, "yt-dlp");
config.tmpDir = tmpDir("kv-ytdlp-tmp-");
const { createYtDlpDownloader } = await import("../src/infrastructure/adapters/yt-dlp");
afterAll(() => Object.assign(config, original));

describe("yt-dlp adapter: duration filter", () => {
  test("an hour-long audio is refused before any download starts", async () => {
    setDuration(3600);
    const result = await createYtDlpDownloader().download("http://x/m1");

    expect(result).toMatchObject({ ok: false, retryable: false, blockReason: BlockReason.TooLong });
    if (!result.ok) expect(result.resource).toMatchObject({ title: "Mix", duration: 3600 });
    expect(existsSync(marker)).toBe(false);
  });

  test("a short track goes on to the download", async () => {
    setDuration(180);
    const result = await createYtDlpDownloader().download("http://x/m1");

    expect(existsSync(marker)).toBe(true); // the (fake) download was attempted
    expect(result).toMatchObject({ ok: false, retryable: true }); // ...and failed like a transient error
  });
});
