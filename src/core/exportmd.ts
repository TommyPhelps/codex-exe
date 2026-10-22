/**
 * Exports one character's adventure as a readable Markdown document.
 * Everything comes straight from the database; the player's own writing is
 * included verbatim.
 */
import type { SqlDriver } from "../db/driver.ts";
import * as repo from "../db/repo.ts";
import { gameById } from "./games.ts";
import { formatDate, formatDateTime } from "./util.ts";

function esc(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

function section(title: string, body: string[]): string[] {
  return body.length ? [`## ${title}`, "", ...body, ""] : [];
}

export interface ExportedMarkdown {
  markdown: string;
  /** Attachment files (relative to the data folder) referenced by the document. */
  files: string[];
}

export async function buildAdventureMarkdown(db: SqlDriver, characterId: string, filesDir = "attachments"): Promise<ExportedMarkdown> {
  const ch = await repo.getCharacter(db, characterId);
  if (!ch) throw new Error("Character not found.");
  const game = gameById(ch.gameId);
  const lines: string[] = [];
  const files: string[] = [];
  const att = async (ownerType: string, ownerId: string) => {
    const list = await repo.listAttachments(db, ownerType, ownerId);
    return list.map((a) => {
      files.push(a.file);
      const name = a.file.split(/[\\/]/).pop() ?? a.file;
      return `![${a.caption || name}](${filesDir}/${encodeURI(name)})`;
    });
  };

  lines.push(`# ${ch.name} — ${game.short}`, "");
  lines.push(`*Exported from CODEX.EXE on ${formatDateTime(new Date().toISOString())}.*`, "");
  if (ch.notes.trim()) lines.push(esc(ch.notes), "");

  const sheet = ch.sheet;
  const sheetLines: string[] = [];
  for (const [k, v] of Object.entries(sheet.fields ?? {})) if (v) sheetLines.push(`- **${k}:** ${v}`);
  if (sheet.build) sheetLines.push("", "**Build notes**", "", esc(sheet.build));
  if (sheet.roleplay) sheetLines.push("", "**Roleplay and rules**", "", esc(sheet.roleplay));
  lines.push(...section("Character", sheetLines));

  const sessions = await repo.listSessions(db, characterId, 500);
  lines.push(
    ...section(
      "Sessions",
      sessions.map((s) => {
        const place = s.lastPlace ? ` — stopped in ${s.lastPlace}${s.lastPlaceSource === "live" ? " (game)" : ""}` : "";
        const next = s.nextNote.trim() ? `\n  - Next time: ${esc(s.nextNote.trim())}` : "";
        return `- ${formatDateTime(s.startedAt)}${s.endedAt ? ` to ${formatDateTime(s.endedAt)}` : " (open)"}${place}${next}`;
      }),
    ),
  );

  const quests = await repo.listQuests(db, characterId);
  const questLines: string[] = [];
  for (const q of quests) {
    questLines.push(`### ${q.title}`, "", `*Status: ${q.status}${q.source === "sync" ? " · synced from the game journal" : ""}*`, "");
    if (q.lastKnown.trim()) questLines.push(`**Last known:** ${esc(q.lastKnown)}`, "");
    if (q.nextAction.trim()) questLines.push(`**Next:** ${esc(q.nextAction)}`, "");
    const items = await repo.listEntries(db, characterId, "quest", q.id);
    for (const e of items) questLines.push(`- [${e.done ? "x" : " "}] (${e.kind}) ${esc(e.title)}`);
    if (items.length) questLines.push("");
    if (q.notes.trim()) questLines.push(esc(q.notes), "");
    const log = await repo.questLog(db, q.id);
    if (log.length) {
      questLines.push("Game journal:", "");
      for (const l of log) if (l.text) questLines.push(`> ${esc(l.text).replace(/\n/g, "\n> ")}`, "");
    }
  }
  lines.push(...section("Quests", questLines));

  const npcs = await repo.listNpcs(db, characterId);
  lines.push(
    ...section(
      "People",
      npcs.map((p) => {
        const bits = [p.occupation, p.place, p.faction].filter(Boolean).join(" · ");
        const facts = [p.facts.asked && `asked: ${p.facts.asked}`, p.facts.promised && `promised: ${p.facts.promised}`, p.notes]
          .filter(Boolean)
          .map((x) => esc(String(x)))
          .join(" — ");
        return `- **${p.name}**${bits ? ` (${bits})` : ""}${facts ? `: ${facts}` : ""}`;
      }),
    ),
  );

  const visits = await repo.listVisits(db, characterId);
  lines.push(...section("Places visited", visits.map((v) => `- ${v.name} — first ${formatDate(v.firstAt)}, ${v.count}×${v.source === "live" ? " (game)" : ""}`)));

  const markers = await repo.listMarkers(db, characterId);
  lines.push(...section("Map markers", markers.map((m) => `- ${m.label || "(unnamed)"} [${m.category}]${m.note ? ` — ${esc(m.note)}` : ""}`)));

  const disc = await repo.listDiscoveries(db, characterId);
  lines.push(...section("Discoveries", disc.map((d) => `- **${d.name}** (${d.category})${d.body ? ` — ${esc(d.body)}` : ""}`)));

  const delves = await repo.listDelves(db, characterId);
  const delveLines: string[] = [];
  for (const d of delves) {
    delveLines.push(`### ${d.name}`, "", `*${d.status}${d.place ? ` · ${d.place}` : ""}*`, "");
    if (d.reason.trim()) delveLines.push(`Left because: ${esc(d.reason)}`, "");
    for (const e of await repo.listEntries(db, characterId, "delve", d.id)) delveLines.push(`- [${e.done ? "x" : " "}] (${e.kind}) ${esc(e.title)}`);
    if (d.notes.trim()) delveLines.push("", esc(d.notes));
    delveLines.push("");
  }
  lines.push(...section("Dungeons", delveLines));

  const ledger = await repo.listEntries(db, characterId, "ledger");
  lines.push(...section("Ledger", ledger.map((e) => `- [${e.done ? "x" : " "}] ${e.kind}: ${esc(e.title)}${e.place ? ` @ ${e.place}` : ""}${e.body ? ` — ${esc(e.body)}` : ""}`)));

  const notes = await repo.listNotes(db, characterId, { kind: "note", limit: 100000 });
  const noteLines: string[] = [];
  for (const x of [...notes].reverse()) {
    noteLines.push(`### ${x.title || formatDateTime(x.createdAt)}`, "");
    const meta = [formatDateTime(x.createdAt), x.place ? `${x.place}${x.placeSource === "live" ? " (game)" : ""}` : "", x.tags.map((t) => `#${t}`).join(" ")].filter(Boolean);
    noteLines.push(`*${meta.join(" · ")}*`, "", esc(x.body), "", ...(await att("note", x.id)), "");
  }
  lines.push(...section("Notes", noteLines));

  const diary = await repo.listNotes(db, characterId, { kind: "diary", limit: 100000 });
  const diaryLines: string[] = [];
  for (const x of [...diary].reverse()) {
    diaryLines.push(`### ${x.title || x.gameDate || formatDate(x.createdAt)}`, "", esc(x.body), "", ...(await att("note", x.id)), "");
  }
  lines.push(...section(`${ch.name}'s diary`, diaryLines));

  const events = await repo.listEvents(db, characterId, { limit: 100000 });
  lines.push(...section("Timeline", [...events].reverse().map((e) => `- ${formatDateTime(e.at)} — ${e.summary}${e.source === "live" ? " *(game)*" : ""}`)));

  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n"), files };
}
