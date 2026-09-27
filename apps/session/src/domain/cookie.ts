// One row per account — a refresh overwrites it, no history kept. blobEncrypted is opaque here;
// only infrastructure/adapters/cookie-cipher.ts ever encrypts/decrypts it, and the decrypted
// value is registered with core's redact() the moment it's produced (see application/
// get-usable-cookie.ts) so it can never reach a log line.
export interface Cookie {
  accountId: number;
  blobEncrypted: string;
  lastUsedAt: number | null;
}

export interface CookieRepository {
  findByAccountId(accountId: number): Promise<Cookie | null>;
  upsert(accountId: number, blobEncrypted: string): Promise<void>;
  touchLastUsed(accountId: number): Promise<void>;
}
