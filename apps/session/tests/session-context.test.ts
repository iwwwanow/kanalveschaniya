import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { createSessionContext } from "../src/application/session-context";
import { encryptCookie } from "../src/infrastructure/adapters/cookie-cipher";
import { testDb, tmpDir } from "./helpers";

const ENCRYPTION_KEY = "test-key-for-session-context";

describe("session-context", () => {
  test("resolveService: matches a known service, null for an unknown one", async () => {
    const { db, services, accounts, cookies } = testDb();
    db.run(`INSERT INTO services (name, url_pattern, requires_cookie) VALUES ('sc', 'soundcloud.com', 1)`);

    const ctx = createSessionContext({ services, accounts, cookies, encryptionKey: ENCRYPTION_KEY, tmpDir: tmpDir() });

    expect(await ctx.resolveService("https://soundcloud.com/x")).toMatchObject({ name: "sc", requiresCookie: true });
    expect(await ctx.resolveService("https://youtube.com/x")).toBeNull();
  });

  test("getUsableCookie: no active account -> null", async () => {
    const { db, services, accounts, cookies } = testDb();
    const serviceId = db.query<{ id: number }, []>(`INSERT INTO services (name, url_pattern) VALUES ('sc', 'sc.com') RETURNING id`).get()!.id;

    const ctx = createSessionContext({ services, accounts, cookies, encryptionKey: ENCRYPTION_KEY, tmpDir: tmpDir() });
    expect(await ctx.getUsableCookie(serviceId)).toBeNull();
  });

  test("getUsableCookie: active account with no cookie yet -> null", async () => {
    const { db, services, accounts, cookies } = testDb();
    const serviceId = db.query<{ id: number }, []>(`INSERT INTO services (name, url_pattern) VALUES ('sc', 'sc.com') RETURNING id`).get()!.id;
    db.run(`INSERT INTO accounts (service_id, status) VALUES (?, 'active')`, [serviceId]);

    const ctx = createSessionContext({ services, accounts, cookies, encryptionKey: ENCRYPTION_KEY, tmpDir: tmpDir() });
    expect(await ctx.getUsableCookie(serviceId)).toBeNull();
  });

  test("getUsableCookie: decrypts, materializes to a temp file, cleanup removes it", async () => {
    const { db, services, accounts, cookies } = testDb();
    const serviceId = db.query<{ id: number }, []>(`INSERT INTO services (name, url_pattern) VALUES ('sc', 'sc.com') RETURNING id`).get()!.id;
    const accountId = db.query<{ id: number }, []>(`INSERT INTO accounts (service_id, status) VALUES (${serviceId}, 'active') RETURNING id`).get()!.id;
    await cookies.upsert(accountId, encryptCookie("plain-cookie-contents", ENCRYPTION_KEY));

    const ctx = createSessionContext({ services, accounts, cookies, encryptionKey: ENCRYPTION_KEY, tmpDir: tmpDir() });
    const usable = await ctx.getUsableCookie(serviceId);

    expect(usable).not.toBeNull();
    expect(existsSync(usable!.filePath)).toBe(true);
    expect(readFileSync(usable!.filePath, "utf8")).toBe("plain-cookie-contents");

    await usable!.cleanup();
    expect(existsSync(usable!.filePath)).toBe(false);
  });
});
