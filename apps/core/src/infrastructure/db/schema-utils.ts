import type { Database } from "bun:sqlite";

// State-based (not log-based) schema helpers: each checks the actual schema first, so it is
// a no-op on a fresh DB and on a DB that was already converted — safe to run on every start.
// Identifiers are code constants, never user input.

function tableExists(db: Database, table: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) != null;
}

function columnExists(db: Database, table: string, column: string): boolean {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

export function renameTableIfExists(db: Database, from: string, to: string): void {
  if (tableExists(db, from) && !tableExists(db, to)) {
    db.run(`ALTER TABLE ${from} RENAME TO ${to}`);
  }
}

export function renameColumnIfExists(db: Database, table: string, from: string, to: string): void {
  if (tableExists(db, table) && columnExists(db, table, from) && !columnExists(db, table, to)) {
    db.run(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}
