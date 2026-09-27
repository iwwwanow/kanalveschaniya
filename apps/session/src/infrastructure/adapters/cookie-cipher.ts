import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Symmetric encryption for cookie blobs at rest (cookies.blob_encrypted in session.db). Key comes
// from SESSION_ENCRYPTION_KEY (see config.ts) — same "secret from env, never logged" pattern as
// core's BOT_TOKEN (registerSecret() is called on the decrypted value at the point of use, see
// application/session-context.ts, not here — this module only ever handles ciphertext plus the
// key, and the key itself is registered as a secret once at startup).
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// scrypt turns an arbitrary-length env secret into exactly 32 bytes for AES-256 —
// SESSION_ENCRYPTION_KEY doesn't have to be a hex-exact key, just a long random string. The salt
// is fixed and non-secret (standard for deriving a single static key from one passphrase); the
// actual secrecy comes entirely from SESSION_ENCRYPTION_KEY itself.
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "session-app-cookie-cipher-v1", 32);
}

export function encryptCookie(plainText: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptCookie(blob: string, secret: string): string {
  const key = deriveKey(secret);
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
