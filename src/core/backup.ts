/**
 * Portable JSON backup of the whole companion database.
 * Restores are all-or-nothing (one transaction) and refuse files written by a
 * newer schema. A safety copy of the current data is taken before restoring
 * (by the caller, through the desktop layer).
 */
import type { SqlDriver, SqlValue, Statement } from "../db/driver.ts";
import { DATA_TABLES, SCHEMA_VERSION } from "../db/schema.ts";

export const BACKUP_FORMAT = "codex-exe-backup";

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schema: number;
  exportedAt: string;
  app: string;
  tables: Record<string, Record<string, SqlValue>[]>;
}

export async function exportBackup(db: SqlDriver, appVersion: string, at = new Date().toISOString()): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  for (const t of DATA_TABLES) {
    tables[t] = await db.select<Record<string, SqlValue>>(`SELECT * FROM ${t}`);
  }
  return { format: BACKUP_FORMAT, schema: SCHEMA_VERSION, exportedAt: at, app: appVersion, tables };
}

export type BackupCheck = { ok: true; file: BackupFile; counts: Record<string, number> } | { ok: false; error: string };

export function checkBackup(raw: unknown): BackupCheck {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "This is not a CODEX.EXE backup file." };
  const f = raw as Partial<BackupFile>;
  if (f.format !== BACKUP_FORMAT) return { ok: false, error: "This is not a CODEX.EXE backup file." };
  if (typeof f.schema !== "number" || !Number.isInteger(f.schema) || f.schema < 1) return { ok: false, error: "The backup has no valid schema version." };
  if (f.schema > SCHEMA_VERSION) {
    return { ok: false, error: `The backup comes from a newer CODEX.EXE (schema ${f.schema}). Update the app before restoring it.` };
  }
  if (typeof f.tables !== "object" || f.tables === null) return { ok: false, error: "The backup contains no data tables." };
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(f.tables)) {
    if (!(DATA_TABLES as readonly string[]).includes(name)) continue;
    if (!Array.isArray(rows)) return { ok: false, error: `Table ${name} is damaged.` };
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) return { ok: false, error: `Table ${name} has a damaged row.` };
      for (const v of Object.values(row)) {
        if (!(v === null || typeof v === "string" || typeof v === "number")) return { ok: false, error: `Table ${name} has an invalid value.` };
      }
    }
    counts[name] = rows.length;
  }
  if (!("characters" in counts)) return { ok: false, error: "The backup has no characters table." };
  return { ok: true, file: f as BackupFile, counts };
}

async function columnsOf(db: SqlDriver, table: string): Promise<string[]> {
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

/** Replaces all companion data with the backup's contents, in one transaction. */
export async function restoreBackup(db: SqlDriver, file: BackupFile): Promise<number> {
  const statements: Statement[] = [];
  for (const t of [...DATA_TABLES].reverse()) statements.push({ sql: `DELETE FROM ${t}` });
  for (const t of DATA_TABLES) {
    const rows = file.tables[t] ?? [];
    if (!rows.length) continue;
    const cols = new Set(await columnsOf(db, t));
    for (const row of rows) {
      const keys = Object.keys(row).filter((k) => cols.has(k));
      if (!keys.length) continue;
      statements.push({
        sql: `INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        params: keys.map((k) => row[k]),
      });
    }
  }
  return db.batch(statements);
}

/** Files referenced by attachments and imported maps, relative to the data folder. */
export function referencedFiles(file: BackupFile): string[] {
  const out = new Set<string>();
  for (const r of file.tables.attachments ?? []) if (typeof r.file === "string") out.add(r.file);
  for (const r of file.tables.maps ?? []) if (typeof r.image === "string" && r.image) out.add(r.image);
  return [...out];
}
