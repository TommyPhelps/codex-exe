/**
 * "Where was I?" - a rule-based recap built only from saved records.
 * No guessing and no generated prose: each sentence comes from a row the
 * player wrote or the bridge reported.
 */
import type { SqlDriver } from "../db/driver.ts";
import * as repo from "../db/repo.ts";
import type { Delve, Entry, Note, Quest, Session, TimelineEvent, Visit } from "../db/repo.ts";
import { formatDate, formatDuration, listJoin, plural, relativeTime, truncate } from "./util.ts";

export interface ResumeData {
  characterName: string;
  session: Session | null;
  sessionOpen: boolean;
  events: TimelineEvent[];
  visits: Visit[];
  quests: Quest[];
  delves: Delve[];
  reminders: Entry[];
  needs: { title: string; from: string }[];
  pinned: Note[];
  sessionNotes: Note[];
  discoveries: { name: string; category: string }[];
}

export async function loadResume(db: SqlDriver, characterId: string): Promise<ResumeData> {
  const ch = await repo.getCharacter(db, characterId);
  const sessions = await repo.listSessions(db, characterId, 5);
  const session = sessions[0] ?? null;
  const since = session?.startedAt;
  const quests = (await repo.listQuests(db, characterId)).filter((q) => q.status === "active");
  const delves = (await repo.listDelves(db, characterId)).filter((d) => d.status === "exploring" || d.status === "left");
  const reminders = (await repo.listEntries(db, characterId, "reminder")).filter((e) => !e.done);
  const buy = (await repo.listEntries(db, characterId, "ledger")).filter((e) => !e.done && (e.kind === "buy" || e.kind === "service"));
  const questItems = (await repo.listEntries(db, characterId, "quest")).filter((e) => !e.done && e.kind === "item");
  const questTitle = new Map(quests.map((q) => [q.id, q.title]));
  const needs = [
    ...buy.map((e) => ({ title: e.title, from: e.place ? `ledger · ${e.place}` : "ledger" })),
    ...questItems.map((e) => ({ title: e.title, from: questTitle.get(e.parentId ?? "") ?? "quest" })),
  ];
  const notes = await repo.listNotes(db, characterId, { limit: 200 });
  const discoveries = (await repo.listDiscoveries(db, characterId)).slice(0, 6).map((d) => ({ name: d.name, category: d.category }));
  return {
    characterName: ch?.name ?? "",
    session,
    sessionOpen: !!session && !session.endedAt,
    events: since ? await repo.listEvents(db, characterId, { since, limit: 300 }) : [],
    visits: since ? await repo.listVisits(db, characterId, { since, limit: 50 }) : [],
    quests,
    delves,
    reminders,
    needs,
    pinned: notes.filter((x) => x.pinned).slice(0, 6),
    sessionNotes: since ? notes.filter((x) => x.createdAt >= since) : [],
    discoveries,
  };
}

/** Builds the recap sentences. Pure: easy to test, nothing invented. */
export function summarize(d: ResumeData, now: Date = new Date()): string[] {
  const out: string[] = [];
  const s = d.session;
  if (!s) {
    if (d.quests.length || d.pinned.length || d.delves.length) {
      out.push("No play sessions recorded yet, but here is what you have written down so far.");
    } else {
      out.push("Nothing recorded yet for this character. Start a session or jot a quick note — it will be waiting here next time.");
      return out;
    }
  } else if (d.sessionOpen) {
    out.push(`Session in progress since ${relativeTime(s.startedAt, now)}.`);
  } else {
    const dur = s.endedAt ? formatDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt)) : "";
    out.push(`You last played ${relativeTime(s.endedAt ?? s.startedAt, now)} (${formatDate(s.startedAt)}${dur ? `, ${dur}` : ""}).`);
  }

  if (s?.lastPlace) {
    out.push(
      s.lastPlaceSource === "live"
        ? `The game last reported you in ${s.lastPlace}.`
        : `You noted that you stopped in ${s.lastPlace}.`,
    );
  }

  const places = [...d.visits]
    .sort((a, z) => a.lastAt.localeCompare(z.lastAt))
    .map((v) => v.name)
    .filter((name, i, all) => all.indexOf(name) === i);
  if (places.length) {
    const shown = places.slice(0, 4);
    const more = places.length - shown.length;
    out.push(`That session you were in ${listJoin(more > 0 ? [...shown, `${more} other place${more === 1 ? "" : "s"}`] : shown)}.`);
  }

  const questEvents = d.events.filter((e) => e.kind === "quest");
  if (questEvents.length) {
    const titles = questEvents
      .map((e) => e.summary.replace(/^[^:]+:\s*/, ""))
      .filter((t, i, all) => all.indexOf(t) === i)
      .slice(0, 3);
    out.push(`Journal activity: ${listJoin(titles.map((t) => `“${t}”`))}.`);
  }

  const levels = d.events.filter((e) => e.kind === "level");
  if (levels.length) out.push(levels[0].summary + ".");

  if (d.sessionNotes.length) out.push(`You wrote ${plural(d.sessionNotes.length, "note")} that session.`);

  for (const dv of d.delves.slice(0, 2)) {
    if (dv.status === "left") {
      out.push(dv.reason.trim() ? `You left ${dv.name} unfinished: “${truncate(dv.reason, 120)}”` : `You left ${dv.name} unfinished.`);
    } else {
      out.push(`You were exploring ${dv.name}.`);
    }
  }

  if (d.needs.length) {
    out.push(`On your list: ${listJoin(d.needs.slice(0, 4).map((n) => n.title))}${d.needs.length > 4 ? ", and more" : ""}.`);
  }
  if (d.reminders.length) out.push(`${plural(d.reminders.length, "reminder")} waiting.`);
  return out;
}
