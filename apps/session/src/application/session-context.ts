import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { registerSecret } from "shared-secrets";
import type { ServiceRepository } from "../domain/service";
import type { AccountRepository } from "../domain/account";
import type { CookieRepository } from "../domain/cookie";
import { decryptCookie } from "../infrastructure/adapters/cookie-cipher";

export interface SessionContextDeps {
  services: ServiceRepository;
  accounts: AccountRepository;
  cookies: CookieRepository;
  encryptionKey: string;
  tmpDir: string;
}

// Implements core's SessionContextPort (apps/core/src/domain/session-context.ts) structurally.
// This module intentionally does not import that type — session-service must not depend on
// core's domain; apps/core/src/main.ts (the composition root for the whole process) wires this
// object in by shape, not by name.
export function createSessionContext(deps: SessionContextDeps) {
  return {
    async resolveService(url: string) {
      const service = await deps.services.findByUrl(url);
      if (!service) return null;
      return { id: service.id, name: service.name, requiresCookie: service.requiresCookie };
    },

    async getUsableCookie(serviceId: number) {
      const account = await deps.accounts.findActiveForService(serviceId);
      if (!account) return null;
      const cookie = await deps.cookies.findByAccountId(account.id);
      if (!cookie) return null;

      const plain = decryptCookie(cookie.blobEncrypted, deps.encryptionKey);
      // Never let the decrypted cookie reach a log line (same discipline as core's BOT_TOKEN).
      registerSecret(plain);

      const filePath = join(deps.tmpDir, `cookie-${account.id}-${Date.now()}.txt`);
      await Bun.write(filePath, plain);
      await deps.cookies.touchLastUsed(account.id);

      return {
        filePath,
        // Best-effort delete, not a secure wipe — see the open question in
        // docs/specs/session-app.specs.md about temp-file handling discipline.
        cleanup: () => unlink(filePath).catch(() => {}),
      };
    },
  };
}
