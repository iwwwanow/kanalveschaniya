// Cap per message: a paste of dozens of links must not fan out into dozens of jobs at once
// (same reasoning as ALLOW_PLAYLIST_DOWNLOADS after the 2026-08-26 incident).
export const MAX_URLS_PER_MESSAGE = 10;

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

// Sentence punctuation glued to the end of a link ("глянь https://x.com/a, круто.")
function trimTrailingPunctuation(candidate: string): string {
  let url = candidate.replace(/[.,;:!?»]+$/, "");
  // A closing bracket belongs to the link only if it has its own opening one (wikipedia/Foo_(bar))
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (url.endsWith(close) && count(url, close) > count(url, open)) url = url.slice(0, -1);
  }
  return url.replace(/[.,;:!?»]+$/, "");
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// "any text → the http(s) links inside it": in order, without duplicates, at most
// MAX_URLS_PER_MESSAGE. Shared between handle-message and listen-channel.
export function extractUrls(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = trimTrailingPunctuation(match[0]);
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    } catch {
      continue;
    }
    if (!found.includes(candidate)) found.push(candidate);
    if (found.length === MAX_URLS_PER_MESSAGE) break;
  }
  return found;
}
