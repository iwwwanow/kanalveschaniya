// A downloadable-content service that may require an authenticated session (cookies) to work —
// e.g. SoundCloud. Resolved from a resource's raw url before any download attempt.
export interface Service {
  id: number;
  name: string; // "soundcloud" — for logs/account grouping
  urlPattern: string; // matched via url.toLowerCase().includes(pattern) — see findByUrl
  requiresCookie: boolean;
}

export interface ServiceRepository {
  // Simple substring match against the raw url (same style as yt-dlp.ts's isGeoBlocked/
  // isDrmProtected) — good enough for hostnames like "soundcloud.com", no need for regex.
  findByUrl(url: string): Promise<Service | null>;
  findById(id: number): Promise<Service | null>;
}
