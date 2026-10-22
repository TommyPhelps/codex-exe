import type { SqlDriver } from "./driver.ts";

export interface Migration {
  version: number;
  name: string;
  sql: string[];
}

const ts = "TEXT NOT NULL";

/**
 * Versioned schema. Each entry upgrades the database by one version and runs
 * inside a single transaction. Never edit a shipped migration: append a new one.
 *
 * Every table that holds adventure data carries `character_id`, so two
 * characters - even two characters in the same game - never share records.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial companion schema",
    sql: [
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sync_name TEXT,
        notes TEXT NOT NULL DEFAULT '',
        sheet TEXT NOT NULL DEFAULT '{}',
        live TEXT NOT NULL DEFAULT '{}',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at ${ts},
        updated_at ${ts},
        last_played_at TEXT
      )`,
      `CREATE INDEX characters_game ON characters(game_id, archived)`,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        started_at ${ts},
        ended_at TEXT,
        source TEXT NOT NULL CHECK (source IN ('live','manual')),
        next_note TEXT NOT NULL DEFAULT '',
        last_place TEXT,
        last_place_source TEXT CHECK (last_place_source IS NULL OR last_place_source IN ('live','manual'))
      )`,
      `CREATE INDEX sessions_char ON sessions(character_id, started_at)`,
      `CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('note','diary')),
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        place TEXT,
        place_source TEXT CHECK (place_source IS NULL OR place_source IN ('live','manual')),
        wx REAL,
        wy REAL,
        game_date TEXT,
        session_id TEXT,
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE INDEX notes_char ON notes(character_id, kind, created_at)`,
      `CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        file TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        created_at ${ts}
      )`,
      `CREATE INDEX attachments_owner ON attachments(owner_type, owner_id)`,
      `CREATE TABLE quests (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','failed','abandoned')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','sync')),
        game_quest_id TEXT,
        stage INTEGER,
        last_known TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at ${ts},
        updated_at ${ts},
        finished_at TEXT
      )`,
      `CREATE INDEX quests_char ON quests(character_id, status, updated_at)`,
      `CREATE UNIQUE INDEX quests_game_id ON quests(character_id, game_quest_id) WHERE game_quest_id IS NOT NULL`,
      `CREATE TABLE quest_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quest_id TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
        stage INTEGER,
        text TEXT NOT NULL DEFAULT '',
        finished INTEGER NOT NULL DEFAULT 0,
        game_date TEXT,
        received_at ${ts}
      )`,
      `CREATE UNIQUE INDEX quest_log_stage ON quest_log(quest_id, stage)`,
      `CREATE TABLE npcs (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        place TEXT NOT NULL DEFAULT '',
        faction TEXT NOT NULL DEFAULT '',
        occupation TEXT NOT NULL DEFAULT '',
        services TEXT NOT NULL DEFAULT '',
        facts TEXT NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE INDEX npcs_char ON npcs(character_id, name)`,
      `CREATE TABLE maps (
        id TEXT PRIMARY KEY,
        character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image','sketch')),
        name TEXT NOT NULL,
        image TEXT,
        calib TEXT,
        sketch TEXT NOT NULL DEFAULT '{"items":[]}',
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE TABLE markers (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        map_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        category TEXT NOT NULL DEFAULT 'custom',
        label TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        color TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE INDEX markers_map ON markers(character_id, map_id)`,
      `CREATE TABLE links (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        a_type TEXT NOT NULL,
        a_id TEXT NOT NULL,
        b_type TEXT NOT NULL,
        b_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at ${ts}
      )`,
      `CREATE UNIQUE INDEX links_pair ON links(a_type, a_id, b_type, b_id)`,
      `CREATE INDEX links_b ON links(b_type, b_id)`,
      `CREATE TABLE discoveries (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'mine' CHECK (source IN ('mine','sync')),
        ref TEXT,
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE INDEX discoveries_char ON discoveries(character_id, category, name)`,
      `CREATE TABLE visits (
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        place_key TEXT NOT NULL,
        name TEXT NOT NULL,
        interior INTEGER NOT NULL DEFAULT 0,
        gx INTEGER,
        gy INTEGER,
        first_at ${ts},
        last_at ${ts},
        count INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL CHECK (source IN ('live','manual')),
        PRIMARY KEY (character_id, place_key)
      )`,
      `CREATE TABLE trail (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        session_id TEXT,
        seg INTEGER NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        at ${ts}
      )`,
      `CREATE INDEX trail_char ON trail(character_id, id)`,
      `CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL CHECK (source IN ('live','manual','app')),
        at ${ts}
      )`,
      `CREATE INDEX events_char ON events(character_id, at)`,
      `CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        parent_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        place TEXT NOT NULL DEFAULT '',
        done INTEGER NOT NULL DEFAULT 0,
        sort REAL NOT NULL DEFAULT 0,
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE INDEX entries_scope ON entries(character_id, scope, parent_id)`,
      `CREATE TABLE delves (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        place TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unexplored' CHECK (status IN ('unexplored','exploring','left','cleared')),
        reason TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        map_id TEXT,
        created_at ${ts},
        updated_at ${ts}
      )`,
      `CREATE INDEX delves_char ON delves(character_id, status)`,
      `CREATE TABLE routes (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        from_place TEXT NOT NULL,
        to_place TEXT NOT NULL,
        mode TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at ${ts}
      )`,
      `CREATE INDEX routes_char ON routes(character_id)`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables included in backups, in an order that satisfies foreign keys on restore. */
export const DATA_TABLES = [
  "settings",
  "characters",
  "sessions",
  "notes",
  "attachments",
  "quests",
  "quest_log",
  "npcs",
  "maps",
  "markers",
  "links",
  "discoveries",
  "visits",
  "trail",
  "events",
  "entries",
  "delves",
  "routes",
] as const;

export async function currentVersion(db: SqlDriver): Promise<number> {
  await db.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const rows = await db.select<{ version: number }>("SELECT version FROM schema_version LIMIT 1");
  return rows.length ? Number(rows[0].version) : 0;
}

/** Brings the database up to the newest schema. Returns the versions applied. */
export async function migrate(db: SqlDriver, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const from = await currentVersion(db);
  const newest = migrations.length ? migrations[migrations.length - 1].version : 0;
  if (from > newest) {
    throw new Error(
      `This data was written by a newer CODEX.EXE (schema ${from}; this build understands ${newest}). Update the app instead of downgrading.`,
    );
  }
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= from) continue;
    const statements = m.sql.map((sql) => ({ sql }));
    statements.push(
      from === 0 && applied.length === 0
        ? { sql: `INSERT INTO schema_version (version) VALUES (${m.version})` }
        : { sql: `UPDATE schema_version SET version = ${m.version}` },
    );
    await db.batch(statements);
    applied.push(m.version);
  }
  return applied;
}
