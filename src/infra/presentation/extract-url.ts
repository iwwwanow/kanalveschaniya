// "текст → валидный URL или null" — shared between handle-message and listen-channel.
export function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return trimmed;
    }
    return null;
  } catch {
    return null;
  }
}
