import texts from "./telegram.localization.json";

// Keys come from the JSON itself: a key removed or misspelled in code (or deleted from the file)
// fails `tsc`.
export type TextKey = keyof typeof texts;

// Placeholders the code passes for each key. A template may use fewer of them (drop one when
// rewording) but must not use others — assertTextsValid() checks that at startup, so a typo
// like {limit} instead of {limit_mb} fails on boot instead of in the middle of a reply.
export const TEXT_PARAMS: Record<TextKey, readonly string[]> = {
  "start": [],
  "queue.empty": [],
  "queue.line": ["status", "count"],
  "channel.admin_only": [],
  "channel.listening_on": [],
  "channel.listening_off": [],
  "channel.history_not_implemented": [],
  "message.no_url": [],
  "message.queued": [],
  "message.duplicate": [],
  "message.queued_many": ["queued"],
  "message.queued_many_with_duplicates": ["queued", "duplicates"],
  "playlist.queued": ["queued", "cached"],
  "failure.geo": [],
  "failure.drm": [],
  "failure.too_large": ["title", "limit_mb"],
  "failure.crashed_repeatedly": [],
  "failure.not_found": [],
  "failure.generic": [],
};

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key: TextKey, params: Record<string, string | number> = {}): string {
  return texts[key].replace(PLACEHOLDER, (_match, name: string) => {
    if (!(name in params)) throw new Error(`text "${key}": no value for {${name}}`);
    return String(params[name]);
  });
}

export function assertTextsValid(): void {
  for (const key of Object.keys(TEXT_PARAMS) as TextKey[]) {
    const template: unknown = texts[key];
    if (typeof template !== "string" || template.trim() === "") {
      throw new Error(`text "${key}" is missing or empty in telegram.localization.json`);
    }
    const allowed = TEXT_PARAMS[key];
    for (const [, name] of template.matchAll(PLACEHOLDER)) {
      if (!allowed.includes(name!)) {
        throw new Error(
          `text "${key}": unknown placeholder {${name}} (available: ${allowed.map((p) => `{${p}}`).join(", ") || "none"})`,
        );
      }
    }
  }
}
