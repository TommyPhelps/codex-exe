// SqlDriver backed by Node's built-in SQLite, so tests exercise the same SQL
// and transaction behaviour as the desktop app's rusqlite commands.
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue, Statement } from "../src/db/driver.ts";
import { migrate } from "../src/db/schema.ts";

export function nodeDriver(path = ":memory:"): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const norm = (p?: SqlValue[]) => (p ?? []) as (string | number | null)[];
  return {
    async select<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
      return db.prepare(sql).all(...norm(params)) as T[];
    },
    async execute(sql: string, params?: SqlValue[]) {
      const r = db.prepare(sql).run(...norm(params));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    async batch(statements: Statement[]) {
      let n = 0;
      db.exec("BEGIN");
      try {
        for (const s of statements) n += Number(db.prepare(s.sql).run(...norm(s.params)).changes);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return n;
    },
    close() {
      db.close();
    },
  };
}

export async function freshDb() {
  const db = nodeDriver();
  await migrate(db);
  return db;
}
