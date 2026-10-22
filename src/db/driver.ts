/** A SQL value as it crosses the bridge to SQLite. */
export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

/**
 * Minimal SQLite interface. The desktop app implements it with Rust commands
 * (rusqlite); tests implement it with node:sqlite. All SQL uses `?` params.
 */
export interface SqlDriver {
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertId: number }>;
  /** Runs every statement inside one transaction. All succeed or none do. */
  batch(statements: Statement[]): Promise<number>;
}
