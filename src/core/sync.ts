/**
 * Applies tracker actions to the database for one character.
 *
 * Only facts the bridge actually reported are written, and every row is
 * marked with source 'live' or 'sync' so the UI can tell them apart from
 * what the player typed.
 */
import type { SqlDriver } from "../db/driver.ts";
import * as repo from "../db/repo.ts";
import type { Character } from "../db/repo.ts";
import type { Action } from "./live.ts";
import type { LiveTime } from "./protocol.ts";
import { cellLabel } from "./protocol.ts";
import { normKey } from "./util.ts";

export interface SyncContext {
  characterId: string;
  sessionId: string | null;
  time?: LiveTime;
  at?: string;
}

export interface SyncResult {
  notices: string[];
  /** Reminder entries whose trigger matched. */
  reminders: string[];
  changed: boolean;
}

const MONTHS = [
  "Morning Star", "Sun's Dawn", "First Seed", "Rain's Hand", "Second Seed", "Midyear",
  "Sun's Height", "Last Seed", "Hearthfire", "Frostfall", "Sun's Dusk", "Evening Star",
];

/** "16 Last Seed, 3E 427" for Tamrielic calendars (Morrowind's bridge reports year 427). */
export function gameDateLabel(t: LiveTime | undefined): string | null {
  if (!t || t.day === undefined || t.month === undefined) return null;
  const month = MONTHS[t.month - 1] ?? `Month ${t.month}`;
  const year = t.year !== undefined ? `, 3E ${t.year}` : "";
  return `${t.day} ${month}${year}`;
}

export async function applyActions(db: SqlDriver, ctx: SyncContext, actions: Action[]): Promise<SyncResult> {
  const result: SyncResult = { notices: [], reminders: [], changed: false };
  const at = ctx.at;
  const gameDate = gameDateLabel(ctx.time);
  let imported = 0;
  let levelUp = false;
  const visitedNames: string[] = [];

  for (const a of actions) {
    switch (a.type) {
      case "visit": {
        const r = await repo.recordVisit(db, ctx.characterId, a.cell, "live", at);
        visitedNames.push(r.name);
        if (ctx.sessionId) await repo.setSessionPlace(db, ctx.sessionId, cellLabel(a.cell), "live");
        if (r.first) {
          await repo.addEvent(db, ctx.characterId, "discover", `Discovered ${r.name}`, "live", { place: r.key }, at);
          if (a.cell.name.trim()) {
            await repo.addDiscovery(db, ctx.characterId, {
              category: "Places",
              name: a.cell.name,
              body: `First visited${gameDate ? ` on ${gameDate}` : ""} (recorded by the game bridge).`,
              source: "sync",
              ref: `place:${r.key}`,
            });
          }
        }
        result.changed = true;
        break;
      }
      case "trail":
        await repo.addTrailPoint(db, ctx.characterId, ctx.sessionId, a.seg, a.x, a.y, at);
        break;
      case "journal": {
        const q = await repo.upsertSyncedQuest(
          db,
          ctx.characterId,
          { questId: a.questId, questName: a.questName, index: a.index, text: a.text, finished: a.finished, gameDate },
          at,
        );
        if (q.stageChanged) {
          const verb = q.created ? "New quest" : a.finished ? "Quest finished" : "Journal updated";
          await repo.addEvent(db, ctx.characterId, "quest", `${verb}: ${q.title}`, "live", { questId: q.id, stage: a.index }, at);
          result.notices.push(`${verb}: ${q.title}`);
        }
        result.changed = true;
        break;
      }
      case "quests":
        for (const item of a.list) {
          const q = await repo.upsertSyncedQuest(db, ctx.characterId, { ...item, gameDate: null }, at);
          if (q.created) imported++;
        }
        result.changed = true;
        break;
      case "loaded":
        await repo.addEvent(db, ctx.characterId, "load", a.save ? `Loaded save “${a.save}”` : a.newGame ? "Started a new game" : "Loaded a game", "live", {}, at);
        result.changed = true;
        break;
      case "timeline":
        await repo.addEvent(db, ctx.characterId, a.kind, a.summary, "live", {}, at);
        if (a.kind === "level") levelUp = true;
        result.notices.push(a.summary);
        result.changed = true;
        break;
      case "state":
      case "session":
      case "saved":
        break;
    }
  }

  if (imported > 0) {
    await repo.addEvent(db, ctx.characterId, "quest", `Imported ${imported} quest${imported === 1 ? "" : "s"} from the game journal`, "live", {}, at);
    result.notices.push(`Imported ${imported} quest${imported === 1 ? "" : "s"} from the game journal`);
  }

  if (visitedNames.length || levelUp) {
    const reminders = await repo.listEntries(db, ctx.characterId, "reminder");
    for (const r of reminders) {
      if (r.done) continue;
      if (r.kind === "level" && levelUp) result.reminders.push(r.id);
      if (r.kind === "place" && r.place.trim()) {
        const want = normKey(r.place);
        if (visitedNames.some((v) => normKey(v).includes(want))) result.reminders.push(r.id);
      }
    }
  }
  return result;
}

export type SyncBinding =
  | { status: "bound"; characterId: string }
  | { status: "unbound"; syncName: string; candidates: Character[] }
  | { status: "ambiguous"; syncName: string; characterIds: string[] };

/**
 * Decides which character receives live data. A character only receives data
 * after the player has linked it to the in-game name - two characters are
 * never merged just because they play the same game.
 */
export function resolveSyncCharacter(characters: Character[], gameId: string, syncName: string, preferredId?: string | null): SyncBinding {
  const key = normKey(syncName);
  const bound = characters.filter((c) => c.gameId === gameId && !c.archived && c.syncName !== null && normKey(c.syncName) === key);
  if (bound.length === 1) return { status: "bound", characterId: bound[0].id };
  if (bound.length > 1 && preferredId && bound.some((c) => c.id === preferredId)) return { status: "bound", characterId: preferredId };
  if (bound.length > 1) return { status: "ambiguous", syncName, characterIds: bound.map((c) => c.id) };
  return { status: "unbound", syncName, candidates: characters.filter((c) => c.gameId === gameId && !c.archived) };
}
