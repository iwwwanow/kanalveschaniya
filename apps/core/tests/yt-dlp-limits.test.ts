import { describe, expect, test } from "bun:test";
import { ESTIMATED_MP3_BYTES_PER_SECOND, maxAudioDurationSeconds } from "../src/infrastructure/adapters/yt-dlp-limits";

const LIMIT = 50 * 1024 * 1024;

describe("maxAudioDurationSeconds", () => {
  test("derives the longest audio that fits the limit (≈28 min for 50MB at mp3 quality 0)", () => {
    const max = maxAudioDurationSeconds(LIMIT);
    expect(max).toBe(Math.floor(LIMIT / ESTIMATED_MP3_BYTES_PER_SECOND));
    expect(max / 60).toBeGreaterThan(27);
    expect(max / 60).toBeLessThan(29);
  });

  test("an hour-long mix is over the derived limit, a 20-minute track is under it", () => {
    const max = maxAudioDurationSeconds(LIMIT);
    expect(60 * 60).toBeGreaterThan(max);
    expect(20 * 60).toBeLessThan(max);
  });

  test("the override replaces the estimate", () => {
    expect(maxAudioDurationSeconds(LIMIT, 3600)).toBe(3600);
  });
});
