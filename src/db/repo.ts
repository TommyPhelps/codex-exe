/**
 * All SQL lives here. Every function takes a SqlDriver, so the same code runs
 * against rusqlite in the desktop app and node:sqlite in the tests.
 */
import type { SqlDriver, SqlValue } from "./driver.ts";
import { newId, nowIso, parseJson, normKey } from "../core/util.ts";
import type { LiveCell } from "../core/protocol.ts";
import { placeKey, cellLabel } from "../core/protocol.ts";

// ------------------------------------------------------------------ types

export interface Character {
  id: string;
  gameId: string;
  name: string;
  syncName: string | null;
  notes: string;
  sheet: CharacterSheet;
  live: Record<string, unknown>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
}

export interface CharacterSheet {
  fields?: Record<string, string>;
  attributes?: Record<string, string>;
  skills?: Record<string, string>;
  majorSkills?: string[];
  minorSkills?: string[];
  build?: string;
  priorities?: string;
  roleplay?: string;
  custom?: { label: string; value: string }[];
}

export interface Session {
  id: string;
  characterId: string;
  startedAt: string;
  endedAt: string | null;
  source: "live" | "manual";
  nextNote: string;
  lastPlace: string | null;
  lastPlaceSource: "live" | "manual" | null;
}

export interface Note {
  id: string;
  characterId: string;
  kind: "note" | "diary";
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  place: string | null;
  placeSource: "live" | "manual" | null;
  wx: number | null;
  wy: number | null;
  gameDate: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QuestStatus = "active" | "paused" | "completed" | "failed" | "abandoned";
export const QUEST_STATUSES: QuestStatus[] = ["active", "paused", "completed", "failed", "abandoned"];

export interface Quest {
  id: string;
  characterId: string;
  title: string;
  status: QuestStatus;
  source: "manual" | "sync";
  gameQuestId: string | null;
  stage: number | null;
  lastKnown: string;
  nextAction: string;
  notes: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface QuestLogEntry {
  id: number;
  questId: string;
  stage: number | null;
  text: string;
  finished: boolean;
  gameDate: string | null;
  receivedAt: string;
}

export interface Npc {
  id: string;
  characterId: string;
  name: string;
  place: string;
  faction: string;
  occupation: string;
  services: string;
  facts: NpcFacts;
  notes: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NpcFacts {
  dialogue?: string;
  asked?: string;
  promised?: string;
  worth?: string;
}

export interface MapRec {
  id: string;
  characterId: string | null;
  gameId: string;
  kind: "image" | "sketch";
  name: string;
  image: string | null;
  calib: string | null;
  sketch: string;
  createdAt: string;
  updatedAt: string;
}

/** The world map of a character's game. Markers on it use world coordinates. */
export const WORLD_MAP = "world";

export interface Marker {
  id: string;
  characterId: string;
  mapId: string;
  x: number;
  y: number;
  category: string;
  label: string;
  note: string;
  color: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LinkType = "quest" | "npc" | "marker" | "note" | "delve" | "entry" | "discovery" | "place" | "faction" | "item";

export interface Link {
  id: string;
  aType: LinkType;
  aId: string;
  bType: LinkType;
  bId: string;
  label: string;
}

export interface Discovery {
  id: string;
  characterId: string;
  category: string;
  name: string;
  body: string;
  source: "mine" | "sync";
  ref: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Visit {
  placeKey: string;
  name: string;
  interior: boolean;
  gx: number | null;
  gy: number | null;
  firstAt: string;
  lastAt: string;
  count: number;
  source: "live" | "manual";
}

export interface TrailPoint {
  id: number;
  seg: number;
  x: number;
  y: number;
  at: string;
}

export interface TimelineEvent {
  id: number;
  kind: string;
  summary: string;
  data: Record<string, unknown>;
  source: "live" | "manual" | "app";
  at: string;
}

export type EntryScope = "quest" | "delve" | "ledger" | "char" | "travel" | "reminder";

export interface Entry {
  id: string;
  characterId: string;
  scope: EntryScope;
  parentId: string | null;
  kind: string;
  title: string;
  body: string;
  place: string;
  done: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export type DelveStatus = "unexplored" | "exploring" | "left" | "cleared";
export const DELVE_STATUSES: DelveStatus[] = ["unexplored", "exploring", "left", "cleared"];

export interface Delve {
  id: string;
  characterId: string;
  name: string;
  place: string;
  status: DelveStatus;
  reason: string;
  notes: string;
  mapId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Route {
  id: string;
  characterId: string;
  fromPlace: string;
  toPlace: string;
  mode: string;
  notes: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  characterId: string;
  ownerType: string;
  ownerId: string;
  file: string;
  caption: string;
  createdAt: string;
}

// ---------------------------------------------------------------- helpers

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number => Number(v ?? 0);
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const b = (v: unknown): boolean => Number(v ?? 0) !== 0;

function setClause(patch: Record<string, SqlValue | undefined>): { sql: string; params: SqlValue[] } {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  return { sql: keys.map((k) => `${k} = ?`).join(", "), params: keys.map((k) => patch[k] as SqlValue) };
}

async function update(db: SqlDriver, table: string, id: string, patch: Record<string, SqlValue | undefined>, touch = true): Promise<void> {
  const full = touch ? { ...patch, updated_at: nowIso() } : patch;
  const { sql, params } = setClause(full);
  if (!sql) return;
  await db.execute(`UPDATE ${table} SET ${sql} WHERE id = ?`, [...params, id]);
}

// --------------------------------------------------------------- settings

export async function getSetting<T>(db: SqlDriver, key: string, fallback: T): Promise<T> {
  const rows = await db.select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return rows.length ? parseJson<T>(rows[0].value, fallback) : fallback;
}

export async function saveSetting(db: SqlDriver, key: string, value: unknown): Promise<void> {
  await db.execute(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)],
  );
}

// ------------------------------------------------------------- characters

function toCharacter(r: Row): Character {
  return {
    id: s(r.id),
    gameId: s(r.game_id),
    name: s(r.name),
    syncName: sn(r.sync_name),
    notes: s(r.notes),
    sheet: parseJson<CharacterSheet>(s(r.sheet), {}),
    live: parseJson<Record<string, unknown>>(s(r.live), {}),
    archived: b(r.archived),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    lastPlayedAt: sn(r.last_played_at),
  };
}

export async function listCharacters(db: SqlDriver, includeArchived = false): Promise<Character[]> {
  const rows = await db.select(
    `SELECT * FROM characters ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY COALESCE(last_played_at, updated_at) DESC`,
  );
  return rows.map(toCharacter);
}

export async function getCharacter(db: SqlDriver, id: string): Promise<Character | null> {
  const rows = await db.select("SELECT * FROM characters WHERE id = ?", [id]);
  return rows.length ? toCharacter(rows[0]) : null;
}

export async function createCharacter(db: SqlDriver, gameId: string, name: string): Promise<string> {
  const id = newId("c");
  const t = nowIso();
  const clean = name.trim() || "Unnamed adventurer";
  await db.execute(
    "INSERT INTO characters (id, game_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, gameId, clean, t, t],
  );
  return id;
}

export async function updateCharacter(
  db: SqlDriver,
  id: string,
  patch: { name?: string; notes?: string; sheet?: CharacterSheet; archived?: boolean; syncName?: string | null },
): Promise<void> {
  await update(db, "characters", id, {
    name: patch.name?.trim() || undefined,
    notes: patch.notes,
    sheet: patch.sheet ? JSON.stringify(patch.sheet) : undefined,
    archived: patch.archived === undefined ? undefined : patch.archived ? 1 : 0,
    sync_name: patch.syncName === undefined ? undefined : patch.syncName,
  });
}

export async function saveLive(db: SqlDriver, id: string, live: Record<string, unknown>): Promise<void> {
  await db.execute("UPDATE characters SET live = ? WHERE id = ?", [JSON.stringify(live), id]);
}

export async function touchPlayed(db: SqlDriver, id: string, at = nowIso()): Promise<void> {
  await db.execute("UPDATE characters SET last_played_at = ? WHERE id = ?", [at, id]);
}

export async function deleteCharacter(db: SqlDriver, id: string): Promise<void> {
  await db.execute("DELETE FROM characters WHERE id = ?", [id]);
}

// --------------------------------------------------------------- sessions

function toSession(r: Row): Session {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    startedAt: s(r.started_at),
    endedAt: sn(r.ended_at),
    source: s(r.source) as Session["source"],
    nextNote: s(r.next_note),
    lastPlace: sn(r.last_place),
    lastPlaceSource: sn(r.last_place_source) as Session["lastPlaceSource"],
  };
}

export async function openSession(db: SqlDriver, characterId: string): Promise<Session | null> {
  const rows = await db.select(
    "SELECT * FROM sessions WHERE character_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    [characterId],
  );
  return rows.length ? toSession(rows[0]) : null;
}

/** Starts a session unless one is already open. Returns the open session id. */
export async function startSession(db: SqlDriver, characterId: string, source: "live" | "manual", at = nowIso()): Promise<string> {
  const existing = await openSession(db, characterId);
  if (existing) return existing.id;
  const id = newId("s");
  await db.execute("INSERT INTO sessions (id, character_id, started_at, source) VALUES (?, ?, ?, ?)", [id, characterId, at, source]);
  await touchPlayed(db, characterId, at);
  return id;
}

export async function endSession(
  db: SqlDriver,
  sessionId: string,
  opts: { nextNote?: string; lastPlace?: string | null; lastPlaceSource?: "live" | "manual" | null; at?: string } = {},
): Promise<void> {
  const at = opts.at ?? nowIso();
  await db.execute(
    `UPDATE sessions SET ended_at = COALESCE(ended_at, ?), next_note = COALESCE(?, next_note),
       last_place = COALESCE(?, last_place), last_place_source = COALESCE(?, last_place_source) WHERE id = ?`,
    [at, opts.nextNote ?? null, opts.lastPlace ?? null, opts.lastPlaceSource ?? null, sessionId],
  );
  const rows = await db.select<{ character_id: string }>("SELECT character_id FROM sessions WHERE id = ?", [sessionId]);
  if (rows.length) await touchPlayed(db, rows[0].character_id, at);
}

export async function setSessionPlace(db: SqlDriver, sessionId: string, place: string, source: "live" | "manual"): Promise<void> {
  await db.execute("UPDATE sessions SET last_place = ?, last_place_source = ? WHERE id = ?", [place, source, sessionId]);
}

export async function setSessionNote(db: SqlDriver, sessionId: string, note: string): Promise<void> {
  await db.execute("UPDATE sessions SET next_note = ? WHERE id = ?", [note, sessionId]);
}

export async function listSessions(db: SqlDriver, characterId: string, limit = 20): Promise<Session[]> {
  const rows = await db.select("SELECT * FROM sessions WHERE character_id = ? ORDER BY started_at DESC LIMIT ?", [characterId, limit]);
  return rows.map(toSession);
}

// ------------------------------------------------------------------ notes

function toNote(r: Row): Note {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    kind: s(r.kind) as Note["kind"],
    title: s(r.title),
    body: s(r.body),
    tags: parseJson<string[]>(s(r.tags), []),
    pinned: b(r.pinned),
    place: sn(r.place),
    placeSource: sn(r.place_source) as Note["placeSource"],
    wx: nn(r.wx),
    wy: nn(r.wy),
    gameDate: sn(r.game_date),
    sessionId: sn(r.session_id),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export interface NewNote {
  characterId: string;
  kind?: "note" | "diary";
  title?: string;
  body: string;
  tags?: string[];
  pinned?: boolean;
  place?: string | null;
  placeSource?: "live" | "manual" | null;
  wx?: number | null;
  wy?: number | null;
  gameDate?: string | null;
  sessionId?: string | null;
  at?: string;
}

export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const k = t.replace(/^#/, "").trim().toLowerCase().slice(0, 40);
    if (k && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 20);
}

export async function addNote(db: SqlDriver, n0: NewNote): Promise<string> {
  const id = newId("n");
  const t = n0.at ?? nowIso();
  // The body is stored exactly as written - never trimmed or rewritten.
  await db.execute(
    `INSERT INTO notes (id, character_id, kind, title, body, tags, pinned, place, place_source, wx, wy, game_date, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      n0.characterId,
      n0.kind ?? "note",
      n0.title ?? "",
      n0.body,
      JSON.stringify(cleanTags(n0.tags ?? [])),
      n0.pinned ? 1 : 0,
      n0.place ?? null,
      n0.place ? (n0.placeSource ?? "manual") : null,
      n0.wx ?? null,
      n0.wy ?? null,
      n0.gameDate ?? null,
      n0.sessionId ?? null,
      t,
      t,
    ],
  );
  return id;
}

export async function updateNote(
  db: SqlDriver,
  id: string,
  patch: { title?: string; body?: string; tags?: string[]; pinned?: boolean; place?: string | null },
): Promise<void> {
  await update(db, "notes", id, {
    title: patch.title,
    body: patch.body,
    tags: patch.tags ? JSON.stringify(cleanTags(patch.tags)) : undefined,
    pinned: patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0,
    place: patch.place === undefined ? undefined : patch.place,
    place_source: patch.place === undefined ? undefined : patch.place ? "manual" : null,
  });
}

export async function deleteNote(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'note' AND a_id = ?) OR (b_type = 'note' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM notes WHERE id = ?", params: [id] },
  ]);
}

export async function getNote(db: SqlDriver, id: string): Promise<Note | null> {
  const rows = await db.select("SELECT * FROM notes WHERE id = ?", [id]);
  return rows.length ? toNote(rows[0]) : null;
}

export async function listNotes(
  db: SqlDriver,
  characterId: string,
  opts: { kind?: "note" | "diary"; tag?: string; limit?: number; since?: string } = {},
): Promise<Note[]> {
  const where = ["character_id = ?"];
  const params: SqlValue[] = [characterId];
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.since) {
    where.push("created_at >= ?");
    params.push(opts.since);
  }
  const rows = await db.select(
    `SELECT * FROM notes WHERE ${where.join(" AND ")} ORDER BY pinned DESC, created_at DESC LIMIT ?`,
    [...params, opts.limit ?? 500],
  );
  let notes = rows.map(toNote);
  if (opts.tag) notes = notes.filter((x) => x.tags.includes(opts.tag!.toLowerCase()));
  return notes;
}

export async function allTags(db: SqlDriver, characterId: string): Promise<{ tag: string; count: number }[]> {
  const notes = await listNotes(db, characterId, { limit: 5000 });
  const counts = new Map<string, number>();
  for (const x of notes) for (const t of x.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, z) => z.count - a.count || a.tag.localeCompare(z.tag));
}

// ------------------------------------------------------------ attachments

function toAttachment(r: Row): Attachment {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    ownerType: s(r.owner_type),
    ownerId: s(r.owner_id),
    file: s(r.file),
    caption: s(r.caption),
    createdAt: s(r.created_at),
  };
}

export async function addAttachment(db: SqlDriver, characterId: string, ownerType: string, ownerId: string, file: string, caption = ""): Promise<string> {
  const id = newId("a");
  await db.execute(
    "INSERT INTO attachments (id, character_id, owner_type, owner_id, file, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, characterId, ownerType, ownerId, file, caption, nowIso()],
  );
  return id;
}

export async function listAttachments(db: SqlDriver, ownerType: string, ownerId: string): Promise<Attachment[]> {
  const rows = await db.select("SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at", [ownerType, ownerId]);
  return rows.map(toAttachment);
}

export async function listAllAttachments(db: SqlDriver, characterId: string): Promise<Attachment[]> {
  const rows = await db.select("SELECT * FROM attachments WHERE character_id = ? ORDER BY created_at DESC", [characterId]);
  return rows.map(toAttachment);
}

export async function deleteAttachment(db: SqlDriver, id: string): Promise<void> {
  await db.execute("DELETE FROM attachments WHERE id = ?", [id]);
}

// ----------------------------------------------------------------- quests

function toQuest(r: Row): Quest {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    title: s(r.title),
    status: s(r.status) as QuestStatus,
    source: s(r.source) as Quest["source"],
    gameQuestId: sn(r.game_quest_id),
    stage: nn(r.stage),
    lastKnown: s(r.last_known),
    nextAction: s(r.next_action),
    notes: s(r.notes),
    pinned: b(r.pinned),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    finishedAt: sn(r.finished_at),
  };
}

export async function createQuest(db: SqlDriver, characterId: string, title: string, extra: { lastKnown?: string; nextAction?: string } = {}): Promise<string> {
  const id = newId("q");
  const t = nowIso();
  await db.execute(
    `INSERT INTO quests (id, character_id, title, last_known, next_action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, characterId, title.trim() || "Untitled quest", extra.lastKnown ?? "", extra.nextAction ?? "", t, t],
  );
  return id;
}

export async function updateQuest(
  db: SqlDriver,
  id: string,
  patch: { title?: string; status?: QuestStatus; lastKnown?: string; nextAction?: string; notes?: string; pinned?: boolean },
): Promise<void> {
  const finished = patch.status && ["completed", "failed", "abandoned"].includes(patch.status);
  await update(db, "quests", id, {
    title: patch.title?.trim() || undefined,
    status: patch.status,
    last_known: patch.lastKnown,
    next_action: patch.nextAction,
    notes: patch.notes,
    pinned: patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0,
    finished_at: patch.status === undefined ? undefined : finished ? nowIso() : null,
  });
}

export async function deleteQuest(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'quest' AND a_id = ?) OR (b_type = 'quest' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM entries WHERE scope = 'quest' AND parent_id = ?", params: [id] },
    { sql: "DELETE FROM quests WHERE id = ?", params: [id] },
  ]);
}

export async function getQuest(db: SqlDriver, id: string): Promise<Quest | null> {
  const rows = await db.select("SELECT * FROM quests WHERE id = ?", [id]);
  return rows.length ? toQuest(rows[0]) : null;
}

export async function listQuests(db: SqlDriver, characterId: string): Promise<Quest[]> {
  const rows = await db.select(
    `SELECT * FROM quests WHERE character_id = ?
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, pinned DESC, updated_at DESC`,
    [characterId],
  );
  return rows.map(toQuest);
}

export async function questLog(db: SqlDriver, questId: string): Promise<QuestLogEntry[]> {
  const rows = await db.select("SELECT * FROM quest_log WHERE quest_id = ? ORDER BY COALESCE(stage, 0), id", [questId]);
  return rows.map((r) => ({
    id: n(r.id),
    questId: s(r.quest_id),
    stage: nn(r.stage),
    text: s(r.text),
    finished: b(r.finished),
    gameDate: sn(r.game_date),
    receivedAt: s(r.received_at),
  }));
}

export interface SyncedQuestInput {
  questId: string;
  questName?: string;
  index: number;
  text?: string;
  finished?: boolean;
  gameDate?: string | null;
}

/**
 * Records a quest state that came from the game. Synced quests are matched
 * only by their game quest id - never merged with a manual quest by title.
 */
export async function upsertSyncedQuest(
  db: SqlDriver,
  characterId: string,
  q: SyncedQuestInput,
  at = nowIso(),
): Promise<{ id: string; created: boolean; stageChanged: boolean; title: string }> {
  const gameId = q.questId.toLowerCase();
  const rows = await db.select("SELECT * FROM quests WHERE character_id = ? AND game_quest_id = ?", [characterId, gameId]);
  const finished = q.finished === true;
  let id: string;
  let created = false;
  let stageChanged = false;
  let title: string;
  if (rows.length) {
    const cur = toQuest(rows[0]);
    id = cur.id;
    title = cur.title;
    stageChanged = cur.stage !== q.index;
    const patch: Record<string, SqlValue | undefined> = {};
    if (stageChanged) patch.stage = q.index;
    // A better name from the game replaces the placeholder id, never a user-edited title.
    if (q.questName && cur.title === cur.gameQuestId) {
      patch.title = q.questName;
      title = q.questName;
    }
    if (finished && cur.status === "active") {
      patch.status = "completed";
      patch.finished_at = at;
    }
    if (Object.keys(patch).length) await update(db, "quests", id, patch);
  } else {
    id = newId("q");
    created = true;
    stageChanged = true;
    title = q.questName || gameId;
    await db.execute(
      `INSERT INTO quests (id, character_id, title, status, source, game_quest_id, stage, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, 'sync', ?, ?, ?, ?, ?)`,
      [id, characterId, title, finished ? "completed" : "active", gameId, q.index, at, at, finished ? at : null],
    );
  }
  if (q.text || stageChanged) {
    await db.execute(
      `INSERT INTO quest_log (quest_id, stage, text, finished, game_date, received_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(quest_id, stage) DO UPDATE SET text = CASE WHEN excluded.text <> '' THEN excluded.text ELSE quest_log.text END,
         finished = excluded.finished`,
      [id, q.index, q.text ?? "", finished ? 1 : 0, q.gameDate ?? null, at],
    );
  }
  return { id, created, stageChanged, title };
}

// ------------------------------------------------------------------- npcs

function toNpc(r: Row): Npc {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    name: s(r.name),
    place: s(r.place),
    faction: s(r.faction),
    occupation: s(r.occupation),
    services: s(r.services),
    facts: parseJson<NpcFacts>(s(r.facts), {}),
    notes: s(r.notes),
    pinned: b(r.pinned),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export async function createNpc(
  db: SqlDriver,
  characterId: string,
  fields: { name: string; place?: string; occupation?: string; faction?: string; services?: string; notes?: string },
): Promise<string> {
  const id = newId("p");
  const t = nowIso();
  await db.execute(
    `INSERT INTO npcs (id, character_id, name, place, occupation, faction, services, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      characterId,
      fields.name.trim() || "Unknown person",
      fields.place ?? "",
      fields.occupation ?? "",
      fields.faction ?? "",
      fields.services ?? "",
      fields.notes ?? "",
      t,
      t,
    ],
  );
  return id;
}

export async function updateNpc(
  db: SqlDriver,
  id: string,
  patch: { name?: string; place?: string; faction?: string; occupation?: string; services?: string; facts?: NpcFacts; notes?: string; pinned?: boolean },
): Promise<void> {
  await update(db, "npcs", id, {
    name: patch.name?.trim() || undefined,
    place: patch.place,
    faction: patch.faction,
    occupation: patch.occupation,
    services: patch.services,
    facts: patch.facts ? JSON.stringify(patch.facts) : undefined,
    notes: patch.notes,
    pinned: patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0,
  });
}

export async function deleteNpc(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'npc' AND a_id = ?) OR (b_type = 'npc' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM npcs WHERE id = ?", params: [id] },
  ]);
}

export async function getNpc(db: SqlDriver, id: string): Promise<Npc | null> {
  const rows = await db.select("SELECT * FROM npcs WHERE id = ?", [id]);
  return rows.length ? toNpc(rows[0]) : null;
}

export async function listNpcs(db: SqlDriver, characterId: string): Promise<Npc[]> {
  const rows = await db.select("SELECT * FROM npcs WHERE character_id = ? ORDER BY pinned DESC, name COLLATE NOCASE", [characterId]);
  return rows.map(toNpc);
}

// ------------------------------------------------------------------- maps

function toMap(r: Row): MapRec {
  return {
    id: s(r.id),
    characterId: sn(r.character_id),
    gameId: s(r.game_id),
    kind: s(r.kind) as MapRec["kind"],
    name: s(r.name),
    image: sn(r.image),
    calib: sn(r.calib),
    sketch: s(r.sketch),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export async function createMap(
  db: SqlDriver,
  characterId: string,
  gameId: string,
  kind: "image" | "sketch",
  name: string,
  image: string | null = null,
): Promise<string> {
  const id = newId("m");
  const t = nowIso();
  await db.execute(
    "INSERT INTO maps (id, character_id, game_id, kind, name, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, characterId, gameId, kind, name.trim() || (kind === "sketch" ? "Sketch" : "Imported map"), image, t, t],
  );
  return id;
}

export async function updateMap(db: SqlDriver, id: string, patch: { name?: string; calib?: string | null; sketch?: string }): Promise<void> {
  await update(db, "maps", id, { name: patch.name?.trim() || undefined, calib: patch.calib, sketch: patch.sketch });
}

export async function deleteMap(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM markers WHERE map_id = ?", params: [id] },
    { sql: "UPDATE delves SET map_id = NULL WHERE map_id = ?", params: [id] },
    { sql: "DELETE FROM maps WHERE id = ?", params: [id] },
  ]);
}

export async function listMaps(db: SqlDriver, characterId: string): Promise<MapRec[]> {
  const rows = await db.select("SELECT * FROM maps WHERE character_id = ? ORDER BY created_at", [characterId]);
  return rows.map(toMap);
}

export async function getMap(db: SqlDriver, id: string): Promise<MapRec | null> {
  const rows = await db.select("SELECT * FROM maps WHERE id = ?", [id]);
  return rows.length ? toMap(rows[0]) : null;
}

// ---------------------------------------------------------------- markers

function toMarker(r: Row): Marker {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    mapId: s(r.map_id),
    x: n(r.x),
    y: n(r.y),
    category: s(r.category),
    label: s(r.label),
    note: s(r.note),
    color: sn(r.color),
    done: b(r.done),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export async function addMarker(
  db: SqlDriver,
  characterId: string,
  m: { mapId: string; x: number; y: number; category?: string; label?: string; note?: string; color?: string | null },
): Promise<string> {
  if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) throw new Error("Marker position must be a number.");
  const id = newId("k");
  const t = nowIso();
  await db.execute(
    `INSERT INTO markers (id, character_id, map_id, x, y, category, label, note, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, characterId, m.mapId, m.x, m.y, m.category ?? "custom", m.label ?? "", m.note ?? "", m.color ?? null, t, t],
  );
  return id;
}

export async function updateMarker(
  db: SqlDriver,
  id: string,
  patch: { x?: number; y?: number; category?: string; label?: string; note?: string; color?: string | null; done?: boolean },
): Promise<void> {
  await update(db, "markers", id, {
    x: patch.x,
    y: patch.y,
    category: patch.category,
    label: patch.label,
    note: patch.note,
    color: patch.color,
    done: patch.done === undefined ? undefined : patch.done ? 1 : 0,
  });
}

export async function deleteMarker(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'marker' AND a_id = ?) OR (b_type = 'marker' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM markers WHERE id = ?", params: [id] },
  ]);
}

export async function listMarkers(db: SqlDriver, characterId: string, mapId?: string): Promise<Marker[]> {
  const rows = mapId
    ? await db.select("SELECT * FROM markers WHERE character_id = ? AND map_id = ? ORDER BY created_at", [characterId, mapId])
    : await db.select("SELECT * FROM markers WHERE character_id = ? ORDER BY created_at", [characterId]);
  return rows.map(toMarker);
}

export async function getMarker(db: SqlDriver, id: string): Promise<Marker | null> {
  const rows = await db.select("SELECT * FROM markers WHERE id = ?", [id]);
  return rows.length ? toMarker(rows[0]) : null;
}

// ------------------------------------------------------------------ links

export async function link(db: SqlDriver, characterId: string, a: { type: LinkType; id: string }, bb: { type: LinkType; id: string }, label = ""): Promise<void> {
  if (a.type === bb.type && a.id === bb.id) return;
  await db.execute(
    `INSERT INTO links (id, character_id, a_type, a_id, b_type, b_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(a_type, a_id, b_type, b_id) DO UPDATE SET label = excluded.label`,
    [newId("l"), characterId, a.type, a.id, bb.type, bb.id, label, nowIso()],
  );
}

export async function unlink(db: SqlDriver, a: { type: LinkType; id: string }, bb: { type: LinkType; id: string }): Promise<void> {
  await db.execute(
    "DELETE FROM links WHERE (a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?) OR (a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?)",
    [a.type, a.id, bb.type, bb.id, bb.type, bb.id, a.type, a.id],
  );
}

/** Everything linked to an item, regardless of which side it was linked from. */
export async function linksOf(db: SqlDriver, type: LinkType, id: string): Promise<{ type: LinkType; id: string; label: string }[]> {
  const rows = await db.select<{ a_type: string; a_id: string; b_type: string; b_id: string; label: string }>(
    "SELECT a_type, a_id, b_type, b_id, label FROM links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?) ORDER BY created_at",
    [type, id, type, id],
  );
  return rows.map((r) =>
    r.a_type === type && r.a_id === id
      ? { type: r.b_type as LinkType, id: r.b_id, label: r.label }
      : { type: r.a_type as LinkType, id: r.a_id, label: r.label },
  );
}

/** Resolves link targets to display names. Missing targets are skipped. */
export async function describeRefs(
  db: SqlDriver,
  refs: { type: LinkType; id: string; label?: string }[],
): Promise<{ type: LinkType; id: string; name: string; label: string }[]> {
  const out: { type: LinkType; id: string; name: string; label: string }[] = [];
  const tables: Partial<Record<LinkType, [string, string]>> = {
    quest: ["quests", "title"],
    npc: ["npcs", "name"],
    marker: ["markers", "label"],
    note: ["notes", "COALESCE(NULLIF(title, ''), substr(body, 1, 80))"],
    delve: ["delves", "name"],
    entry: ["entries", "title"],
    discovery: ["discoveries", "name"],
  };
  for (const r of refs) {
    const t = tables[r.type];
    if (!t) {
      out.push({ type: r.type, id: r.id, name: r.id, label: r.label ?? "" });
      continue;
    }
    const rows = await db.select<{ name: string }>(`SELECT ${t[1]} AS name FROM ${t[0]} WHERE id = ?`, [r.id]);
    if (rows.length) out.push({ type: r.type, id: r.id, name: s(rows[0].name) || "(untitled)", label: r.label ?? "" });
  }
  return out;
}

// ------------------------------------------------------------ discoveries

function toDiscovery(r: Row): Discovery {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    category: s(r.category),
    name: s(r.name),
    body: s(r.body),
    source: s(r.source) as Discovery["source"],
    ref: sn(r.ref),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export async function addDiscovery(
  db: SqlDriver,
  characterId: string,
  d: { category: string; name: string; body?: string; source?: "mine" | "sync"; ref?: string | null },
): Promise<string> {
  if (d.source === "sync" && d.ref) {
    const existing = await db.select<{ id: string }>("SELECT id FROM discoveries WHERE character_id = ? AND ref = ?", [characterId, d.ref]);
    if (existing.length) return existing[0].id;
  }
  const id = newId("d");
  const t = nowIso();
  await db.execute(
    "INSERT INTO discoveries (id, character_id, category, name, body, source, ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, characterId, d.category, d.name.trim() || "Untitled", d.body ?? "", d.source ?? "mine", d.ref ?? null, t, t],
  );
  return id;
}

export async function updateDiscovery(db: SqlDriver, id: string, patch: { category?: string; name?: string; body?: string }): Promise<void> {
  await update(db, "discoveries", id, { category: patch.category, name: patch.name?.trim() || undefined, body: patch.body });
}

export async function deleteDiscovery(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'discovery' AND a_id = ?) OR (b_type = 'discovery' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM discoveries WHERE id = ?", params: [id] },
  ]);
}

export async function listDiscoveries(db: SqlDriver, characterId: string, category?: string): Promise<Discovery[]> {
  const rows = category
    ? await db.select("SELECT * FROM discoveries WHERE character_id = ? AND category = ? ORDER BY name COLLATE NOCASE", [characterId, category])
    : await db.select("SELECT * FROM discoveries WHERE character_id = ? ORDER BY created_at DESC", [characterId]);
  return rows.map(toDiscovery);
}

// ----------------------------------------------------------------- visits

function toVisit(r: Row): Visit {
  return {
    placeKey: s(r.place_key),
    name: s(r.name),
    interior: b(r.interior),
    gx: nn(r.gx),
    gy: nn(r.gy),
    firstAt: s(r.first_at),
    lastAt: s(r.last_at),
    count: n(r.count),
    source: s(r.source) as Visit["source"],
  };
}

export async function recordVisit(
  db: SqlDriver,
  characterId: string,
  cell: LiveCell,
  source: "live" | "manual",
  at = nowIso(),
): Promise<{ first: boolean; key: string; name: string }> {
  const key = placeKey(cell);
  const name = cellLabel(cell);
  const rows = await db.select("SELECT count FROM visits WHERE character_id = ? AND place_key = ?", [characterId, key]);
  if (rows.length) {
    await db.execute("UPDATE visits SET last_at = ?, count = count + 1, name = ? WHERE character_id = ? AND place_key = ?", [
      at,
      name,
      characterId,
      key,
    ]);
    return { first: false, key, name };
  }
  await db.execute(
    "INSERT INTO visits (character_id, place_key, name, interior, gx, gy, first_at, last_at, count, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
    [characterId, key, name, cell.exterior ? 0 : 1, cell.gx ?? null, cell.gy ?? null, at, at, source],
  );
  return { first: true, key, name };
}

export async function listVisits(db: SqlDriver, characterId: string, opts: { limit?: number; since?: string; exteriorOnly?: boolean } = {}): Promise<Visit[]> {
  const where = ["character_id = ?"];
  const params: SqlValue[] = [characterId];
  if (opts.since) {
    where.push("last_at >= ?");
    params.push(opts.since);
  }
  if (opts.exteriorOnly) where.push("interior = 0");
  const rows = await db.select(`SELECT * FROM visits WHERE ${where.join(" AND ")} ORDER BY last_at DESC LIMIT ?`, [...params, opts.limit ?? 100000]);
  return rows.map(toVisit);
}

export async function forgetVisit(db: SqlDriver, characterId: string, key: string): Promise<void> {
  await db.execute("DELETE FROM visits WHERE character_id = ? AND place_key = ?", [characterId, key]);
}

// ------------------------------------------------------------------ trail

export async function addTrailPoint(db: SqlDriver, characterId: string, sessionId: string | null, seg: number, x: number, y: number, at = nowIso()): Promise<void> {
  await db.execute("INSERT INTO trail (character_id, session_id, seg, x, y, at) VALUES (?, ?, ?, ?, ?, ?)", [characterId, sessionId, seg, x, y, at]);
}

export async function listTrail(db: SqlDriver, characterId: string, limit = 20000): Promise<TrailPoint[]> {
  const rows = await db.select(
    "SELECT * FROM (SELECT id, seg, x, y, at FROM trail WHERE character_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
    [characterId, limit],
  );
  return rows.map((r) => ({ id: n(r.id), seg: n(r.seg), x: n(r.x), y: n(r.y), at: s(r.at) }));
}

export async function maxTrailSeg(db: SqlDriver, characterId: string): Promise<number> {
  const rows = await db.select<{ m: number | null }>("SELECT MAX(seg) AS m FROM trail WHERE character_id = ?", [characterId]);
  return Number(rows[0]?.m ?? 0);
}

export async function clearTrail(db: SqlDriver, characterId: string): Promise<void> {
  await db.execute("DELETE FROM trail WHERE character_id = ?", [characterId]);
}

// --------------------------------------------------------------- timeline

export async function addEvent(
  db: SqlDriver,
  characterId: string,
  kind: string,
  summary: string,
  source: "live" | "manual" | "app",
  data: Record<string, unknown> = {},
  at = nowIso(),
): Promise<void> {
  await db.execute("INSERT INTO events (character_id, kind, summary, data, source, at) VALUES (?, ?, ?, ?, ?, ?)", [
    characterId,
    kind,
    summary,
    JSON.stringify(data),
    source,
    at,
  ]);
}

export async function listEvents(db: SqlDriver, characterId: string, opts: { limit?: number; since?: string } = {}): Promise<TimelineEvent[]> {
  const rows = opts.since
    ? await db.select("SELECT * FROM events WHERE character_id = ? AND at >= ? ORDER BY at DESC, id DESC LIMIT ?", [characterId, opts.since, opts.limit ?? 500])
    : await db.select("SELECT * FROM events WHERE character_id = ? ORDER BY at DESC, id DESC LIMIT ?", [characterId, opts.limit ?? 500]);
  return rows.map((r) => ({
    id: n(r.id),
    kind: s(r.kind),
    summary: s(r.summary),
    data: parseJson<Record<string, unknown>>(s(r.data), {}),
    source: s(r.source) as TimelineEvent["source"],
    at: s(r.at),
  }));
}

// ---------------------------------------------------------------- entries

function toEntry(r: Row): Entry {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    scope: s(r.scope) as EntryScope,
    parentId: sn(r.parent_id),
    kind: s(r.kind),
    title: s(r.title),
    body: s(r.body),
    place: s(r.place),
    done: b(r.done),
    sort: n(r.sort),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export async function addEntry(
  db: SqlDriver,
  characterId: string,
  e: { scope: EntryScope; parentId?: string | null; kind: string; title: string; body?: string; place?: string },
): Promise<string> {
  const id = newId("e");
  const t = nowIso();
  const rows = await db.select<{ m: number | null }>(
    "SELECT MAX(sort) AS m FROM entries WHERE character_id = ? AND scope = ? AND COALESCE(parent_id, '') = ?",
    [characterId, e.scope, e.parentId ?? ""],
  );
  const sort = Number(rows[0]?.m ?? 0) + 1;
  await db.execute(
    `INSERT INTO entries (id, character_id, scope, parent_id, kind, title, body, place, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, characterId, e.scope, e.parentId ?? null, e.kind, e.title, e.body ?? "", e.place ?? "", sort, t, t],
  );
  return id;
}

export async function updateEntry(
  db: SqlDriver,
  id: string,
  patch: { kind?: string; title?: string; body?: string; place?: string; done?: boolean; sort?: number },
): Promise<void> {
  await update(db, "entries", id, {
    kind: patch.kind,
    title: patch.title,
    body: patch.body,
    place: patch.place,
    done: patch.done === undefined ? undefined : patch.done ? 1 : 0,
    sort: patch.sort,
  });
}

export async function deleteEntry(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'entry' AND a_id = ?) OR (b_type = 'entry' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM entries WHERE id = ?", params: [id] },
  ]);
}

export async function listEntries(db: SqlDriver, characterId: string, scope: EntryScope, parentId?: string | null): Promise<Entry[]> {
  const rows =
    parentId === undefined
      ? await db.select("SELECT * FROM entries WHERE character_id = ? AND scope = ? ORDER BY done, sort, created_at", [characterId, scope])
      : await db.select(
          "SELECT * FROM entries WHERE character_id = ? AND scope = ? AND COALESCE(parent_id, '') = ? ORDER BY done, sort, created_at",
          [characterId, scope, parentId ?? ""],
        );
  return rows.map(toEntry);
}

// ----------------------------------------------------------------- delves

function toDelve(r: Row): Delve {
  return {
    id: s(r.id),
    characterId: s(r.character_id),
    name: s(r.name),
    place: s(r.place),
    status: s(r.status) as DelveStatus,
    reason: s(r.reason),
    notes: s(r.notes),
    mapId: sn(r.map_id),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export async function createDelve(db: SqlDriver, characterId: string, name: string, place = ""): Promise<string> {
  const id = newId("v");
  const t = nowIso();
  await db.execute("INSERT INTO delves (id, character_id, name, place, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    characterId,
    name.trim() || "Unnamed dungeon",
    place,
    t,
    t,
  ]);
  return id;
}

export async function updateDelve(
  db: SqlDriver,
  id: string,
  patch: { name?: string; place?: string; status?: DelveStatus; reason?: string; notes?: string; mapId?: string | null },
): Promise<void> {
  await update(db, "delves", id, {
    name: patch.name?.trim() || undefined,
    place: patch.place,
    status: patch.status,
    reason: patch.reason,
    notes: patch.notes,
    map_id: patch.mapId,
  });
}

export async function deleteDelve(db: SqlDriver, id: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM links WHERE (a_type = 'delve' AND a_id = ?) OR (b_type = 'delve' AND b_id = ?)", params: [id, id] },
    { sql: "DELETE FROM entries WHERE scope = 'delve' AND parent_id = ?", params: [id] },
    { sql: "DELETE FROM delves WHERE id = ?", params: [id] },
  ]);
}

export async function listDelves(db: SqlDriver, characterId: string): Promise<Delve[]> {
  const rows = await db.select(
    `SELECT * FROM delves WHERE character_id = ?
     ORDER BY CASE status WHEN 'exploring' THEN 0 WHEN 'left' THEN 1 WHEN 'unexplored' THEN 2 ELSE 3 END, updated_at DESC`,
    [characterId],
  );
  return rows.map(toDelve);
}

// ----------------------------------------------------------------- routes

export async function addRoute(db: SqlDriver, characterId: string, r: { fromPlace: string; toPlace: string; mode: string; notes?: string }): Promise<string> {
  const id = newId("r");
  await db.execute("INSERT INTO routes (id, character_id, from_place, to_place, mode, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    id,
    characterId,
    r.fromPlace.trim(),
    r.toPlace.trim(),
    r.mode,
    r.notes ?? "",
    nowIso(),
  ]);
  return id;
}

export async function deleteRoute(db: SqlDriver, id: string): Promise<void> {
  await db.execute("DELETE FROM routes WHERE id = ?", [id]);
}

export async function listRoutes(db: SqlDriver, characterId: string): Promise<Route[]> {
  const rows = await db.select("SELECT * FROM routes WHERE character_id = ? ORDER BY from_place COLLATE NOCASE, to_place COLLATE NOCASE", [characterId]);
  return rows.map((r) => ({
    id: s(r.id),
    characterId: s(r.character_id),
    fromPlace: s(r.from_place),
    toPlace: s(r.to_place),
    mode: s(r.mode),
    notes: s(r.notes),
    createdAt: s(r.created_at),
  }));
}

// ----------------------------------------------------------------- search

export interface SearchHit {
  type: "note" | "diary" | "quest" | "npc" | "marker" | "discovery" | "entry" | "delve" | "route" | "visit";
  id: string;
  title: string;
  snippet: string;
  /** Extra routing info, e.g. the entry scope or the marker's map. */
  scope?: string;
  parentId?: string | null;
}

function snippet(text: string, q: string, width = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, width);
  const start = Math.max(0, i - 30);
  return (start > 0 ? "…" : "") + flat.slice(start, start + width) + (start + width < flat.length ? "…" : "");
}

/** Searches everything the player recorded for one character (case-insensitive substring). */
export async function searchAll(db: SqlDriver, characterId: string, query: string, limit = 60): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const L = "LIKE ? ESCAPE '\\'";
  const hits: SearchHit[] = [];
  const notes = await db.select(`SELECT id, kind, title, body FROM notes WHERE character_id = ? AND (title ${L} OR body ${L} OR tags ${L}) ORDER BY created_at DESC LIMIT ?`, [characterId, like, like, like, limit]);
  for (const r of notes) hits.push({ type: s(r.kind) === "diary" ? "diary" : "note", id: s(r.id), title: s(r.title) || snippet(s(r.body), q, 50), snippet: snippet(s(r.body), q) });
  const quests = await db.select(
    `SELECT id, title, last_known, next_action, notes FROM quests WHERE character_id = ? AND (title ${L} OR last_known ${L} OR next_action ${L} OR notes ${L} OR game_quest_id ${L}) LIMIT ?`,
    [characterId, like, like, like, like, like, limit],
  );
  for (const r of quests) hits.push({ type: "quest", id: s(r.id), title: s(r.title), snippet: snippet(`${s(r.last_known)} ${s(r.next_action)} ${s(r.notes)}`, q) });
  const npcs = await db.select(
    `SELECT id, name, place, occupation, faction, services, facts, notes FROM npcs WHERE character_id = ? AND (name ${L} OR place ${L} OR occupation ${L} OR faction ${L} OR services ${L} OR facts ${L} OR notes ${L}) LIMIT ?`,
    [characterId, like, like, like, like, like, like, like, limit],
  );
  for (const r of npcs) hits.push({ type: "npc", id: s(r.id), title: s(r.name), snippet: snippet([s(r.occupation), s(r.place), s(r.notes)].filter(Boolean).join(" · "), q) });
  const markers = await db.select(`SELECT id, label, note, map_id FROM markers WHERE character_id = ? AND (label ${L} OR note ${L}) LIMIT ?`, [characterId, like, like, limit]);
  for (const r of markers) hits.push({ type: "marker", id: s(r.id), title: s(r.label) || "(unnamed marker)", snippet: snippet(s(r.note), q), scope: s(r.map_id) });
  const disc = await db.select(`SELECT id, name, category, body FROM discoveries WHERE character_id = ? AND (name ${L} OR body ${L}) LIMIT ?`, [characterId, like, like, limit]);
  for (const r of disc) hits.push({ type: "discovery", id: s(r.id), title: s(r.name), snippet: `${s(r.category)} · ${snippet(s(r.body), q)}` });
  const entries = await db.select(`SELECT id, scope, parent_id, kind, title, body, place FROM entries WHERE character_id = ? AND (title ${L} OR body ${L} OR place ${L}) LIMIT ?`, [characterId, like, like, like, limit]);
  for (const r of entries) hits.push({ type: "entry", id: s(r.id), title: s(r.title), snippet: snippet(`${s(r.place)} ${s(r.body)}`, q), scope: s(r.scope), parentId: sn(r.parent_id) });
  const delves = await db.select(`SELECT id, name, place, notes, reason FROM delves WHERE character_id = ? AND (name ${L} OR place ${L} OR notes ${L} OR reason ${L}) LIMIT ?`, [characterId, like, like, like, like, limit]);
  for (const r of delves) hits.push({ type: "delve", id: s(r.id), title: s(r.name), snippet: snippet(`${s(r.place)} ${s(r.reason)} ${s(r.notes)}`, q) });
  const routes = await db.select(`SELECT id, from_place, to_place, mode, notes FROM routes WHERE character_id = ? AND (from_place ${L} OR to_place ${L} OR notes ${L}) LIMIT ?`, [characterId, like, like, like, limit]);
  for (const r of routes) hits.push({ type: "route", id: s(r.id), title: `${s(r.from_place)} → ${s(r.to_place)}`, snippet: `${s(r.mode)} ${s(r.notes)}`.trim() });
  const visits = await db.select(`SELECT place_key, name FROM visits WHERE character_id = ? AND name ${L} LIMIT ?`, [characterId, like, limit]);
  for (const r of visits) hits.push({ type: "visit", id: s(r.place_key), title: s(r.name), snippet: "Visited place" });
  const qk = normKey(q);
  const rank = (h: SearchHit) => (normKey(h.title).startsWith(qk) ? 0 : normKey(h.title).includes(qk) ? 1 : 2);
  return hits.sort((a, z) => rank(a) - rank(z)).slice(0, limit);
}
