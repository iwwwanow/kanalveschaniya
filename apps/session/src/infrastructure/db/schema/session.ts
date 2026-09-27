import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { AccountStatus } from "../../../domain/account";
import type { AccountJobStatus } from "../../../domain/account-job";

// session.db — session-service's own database, separate from core's app.db (see
// docs/specs/session-app.specs.md). Core migrates/owns app.db; session-service migrates/owns this.

export const servicesTable = sqliteTable("services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  urlPattern: text("url_pattern").notNull(),
  requiresCookie: integer("requires_cookie", { mode: "boolean" }).notNull().default(false),
});

export const proxiesTable = sqliteTable("proxies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  createdAt: integer("created_at").default(sql`(unixepoch())`),
});

export const accountsTable = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serviceId: integer("service_id").notNull(),
    status: text("status").$type<AccountStatus>().notNull().default("active" as AccountStatus),
    proxyId: integer("proxy_id"),
    // Opaque vendor-specific handle (see domain/account.ts) — TODO once a vendor is picked.
    vendorRef: text("vendor_ref"),
    createdAt: integer("created_at").default(sql`(unixepoch())`),
  },
  (t) => [
    // One proxy can't sit behind two accounts of the SAME service (IP correlation risk) — NULL
    // proxy_id is exempt (SQLite: NULL never equals NULL in a unique index), so multiple
    // proxy-less accounts of the same service are still allowed.
    unique().on(t.serviceId, t.proxyId),
  ],
);

export const cookiesTable = sqliteTable("cookies", {
  // One row per account — a refresh overwrites it, no history kept.
  accountId: integer("account_id").primaryKey(),
  blobEncrypted: text("blob_encrypted").notNull(),
  createdAt: integer("created_at").default(sql`(unixepoch())`),
  lastUsedAt: integer("last_used_at"),
});

export const accountJobsTable = sqliteTable("account_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  status: text("status").$type<AccountJobStatus>().notNull().default("pending" as AccountJobStatus),
  retries: integer("retries").notNull().default(0),
  retryAfter: integer("retry_after"),
  error: text("error"),
  createdAt: integer("created_at").default(sql`(unixepoch())`),
});
