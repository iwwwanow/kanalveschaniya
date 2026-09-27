import { describe, expect, test } from "bun:test";
import { decryptCookie, encryptCookie } from "../src/infrastructure/adapters/cookie-cipher";

describe("cookie-cipher", () => {
  test("round-trips a plaintext cookie blob", () => {
    const plain = "# Netscape HTTP Cookie File\n.soundcloud.com\tTRUE\t/\tTRUE\t0\toauth_token\tabc123";
    const encrypted = decryptCookie(encryptCookie(plain, "a-long-enough-secret"), "a-long-enough-secret");
    expect(encrypted).toBe(plain);
  });

  test("the ciphertext never contains the plaintext", () => {
    const plain = "super-secret-cookie-value";
    const encrypted = encryptCookie(plain, "another-secret-key");
    expect(encrypted).not.toContain(plain);
  });

  test("two encryptions of the same value differ (random IV)", () => {
    const plain = "same-value";
    const a = encryptCookie(plain, "key");
    const b = encryptCookie(plain, "key");
    expect(a).not.toBe(b);
  });

  test("decrypting with the wrong key fails instead of silently returning garbage", () => {
    const encrypted = encryptCookie("value", "correct-key");
    expect(() => decryptCookie(encrypted, "wrong-key")).toThrow();
  });
});
