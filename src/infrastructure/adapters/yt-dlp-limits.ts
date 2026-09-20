// The audio is encoded with `-x --audio-format mp3 --audio-quality 0` (see yt-dlp.ts): LAME VBR V0,
// ≈245 kbit/s on average. That average is what makes a duration an estimate of the file size,
// so this knowledge belongs to the yt-dlp adapter, not to the application.
export const ESTIMATED_MP3_BYTES_PER_SECOND = Math.round(245_000 / 8);

// Longest audio (seconds) expected to fit the upload limit; `override` (MAX_TRACK_DURATION_SECONDS)
// replaces the estimate when the real content compresses better or worse than the average.
export function maxAudioDurationSeconds(maxFileSizeBytes: number, override?: number): number {
  return override ?? Math.floor(maxFileSizeBytes / ESTIMATED_MP3_BYTES_PER_SECOND);
}
