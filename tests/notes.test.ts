// Markdown subset, quick entry parsing, hotkeys, Markdown export, backups, resume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline, toggleCheckbox, checklistProgress, plainText } from "../src/core/markdown.ts";
import { parseNpcQuick, parseAtPlace, extractTags, normalizeHotkey, hotkeyConflicts, DEFAULT_HOTKEYS } from "../src/core/quick.ts";
import { buildAdventureMarkdown } from "../src/core/exportmd.ts";
import { exportBackup, checkBackup, restoreBackup, referencedFiles } from "../src/core/backup.ts";
import { loadResume, summarize } from "../src/core/resume.ts";
import type { ResumeData } from "../src/core/resume.ts";
import { freshDb } from "./nodeDriver.ts";
import * as repo from "../src/db/repo.ts";

test("markdown: blocks, inline styles, checklists and safe links", () => {
  const src = "# Plan\n\nBuy **silver** and *scrolls*.\n\n- [ ] Ask about `the ring`\n- [x] Rest\n- plain item\n\n1. first\n2. second\n\n> quoted\n\n---\n\n[UESP](https://en.uesp.net) [bad](javascript:alert(1))";
  const blocks = parseMarkdown(src);
  assert.deepEqual(blocks.map((b) => b.t), ["h", "p", "ul", "ol", "quote", "hr", "p"]);
  const ul = blocks[2];
  assert.ok(ul.t === "ul");
  if (ul.t !== "ul") return;
  assert.deepEqual(ul.items.map((i) => i.checked), [false, true, null]);
  assert.equal(ul.items[0].line, 4);
  const last = blocks[6];
  assert.ok(last.t === "p");
  if (last.t !== "p") return;
  assert.equal(last.content[0].t, "link");
  // javascript: links stay plain text.
  assert.ok(last.content.every((i) => i.t !== "link" || i.href.startsWith("https://")));
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "text", v: "2 * 3 * 4" }]);
  assert.deepEqual(parseInline("snake_case_name"), [{ t: "text", v: "snake_case_name" }]);
});

test("markdown: toggling checkboxes edits only that line", () => {
  const src = "Shopping\n- [ ] bread\n- [x] cheese\n  * [ ] nested";
  const once = toggleCheckbox(src, 1);
  assert.equal(once, "Shopping\n- [x] bread\n- [x] cheese\n  * [ ] nested");
  assert.equal(toggleCheckbox(once, 2), "Shopping\n- [x] bread\n- [ ] cheese\n  * [ ] nested");
  assert.equal(toggleCheckbox(src, 0), src);
  assert.equal(toggleCheckbox(src, 99), src);
  assert.deepEqual(checklistProgress(src), { done: 1, total: 3 });
  assert.equal(plainText("## Hi **there** - [x] done [l](https://x)"), "Hi there - [x] done l");
});

test("quick entry parsing", () => {
  assert.deepEqual(parseNpcQuick("Ajira @ Balmora - sells alchemy gear"), { name: "Ajira", place: "Balmora", note: "sells alchemy gear" });
  assert.deepEqual(parseNpcQuick("Trainer: couldn't afford the training"), { name: "Trainer", place: "", note: "couldn't afford the training" });
  assert.deepEqual(parseNpcQuick("Just A Name"), { name: "Just A Name", place: "", note: "" });
  assert.deepEqual(parseAtPlace("Extra armor in a chest @ Balmora"), { title: "Extra armor in a chest", place: "Balmora" });
  assert.deepEqual(parseAtPlace("Nothing here"), { title: "Nothing here", place: "" });
  assert.deepEqual(extractTags("Need #gold and #Quest-items, not a#tag #x"), ["gold", "quest-items"]);
});

test("hotkeys must include a strong modifier and are normalised", () => {
  const ok = normalizeHotkey("alt + ctrl + n");
  assert.deepEqual(ok, { ok: true, normalized: "Ctrl+Alt+N" });
  assert.equal(normalizeHotkey("N").ok, false);
  assert.equal(normalizeHotkey("Shift+N").ok, false);
  assert.equal(normalizeHotkey("Alt+F4").ok, false);
  assert.equal(normalizeHotkey("Ctrl+Alt").ok, false);
  assert.equal(normalizeHotkey("Ctrl+N+M").ok, false);
  const warn = normalizeHotkey("Ctrl+W");
  assert.ok(warn.ok && warn.warning);
  const f5 = normalizeHotkey("ctrl+alt+f5");
  assert.ok(f5.ok && f5.normalized === "Ctrl+Alt+F5" && !f5.warning);
  assert.deepEqual(hotkeyConflicts(DEFAULT_HOTKEYS), []);
  assert.equal(hotkeyConflicts({ ...DEFAULT_HOTKEYS, markHere: DEFAULT_HOTKEYS.quickNote }).length, 1);
});

async function seed() {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "Nerevar");
  const q = await repo.createQuest(db, c, "The Missing Informant", { lastKnown: "Someone in Balmora told me to look near the river.", nextAction: "Explore the western bank." });
  await repo.addEntry(db, c, { scope: "quest", parentId: q, kind: "item", title: "A light source" });
  await repo.createNpc(db, c, { name: "Trainer", place: "Balmora", notes: "I couldn't afford the training." });
  const note = await repo.addNote(db, { characterId: c, body: "Come back when I have 2,000 gold.", place: "Balmora", placeSource: "live", tags: ["gold"] });
  await repo.addAttachment(db, c, "note", note, "attachments/shot1.png", "the shop");
  await repo.addNote(db, { characterId: c, kind: "diary", body: "Dear diary. The *ashstorm* again." });
  const d = await repo.createDelve(db, c, "Cave near Balmora");
  await repo.updateDelve(db, d, { status: "left", reason: "Needed better equipment" });
  await repo.addEntry(db, c, { scope: "ledger", kind: "buy", title: "Restore Health potions", place: "Balmora" });
  await repo.addEntry(db, c, { scope: "reminder", kind: "anytime", title: "Revisit the merchant" });
  return { db, c, q };
}

test("Markdown export contains the player's words verbatim and lists attachments", async () => {
  const { db, c } = await seed();
  const { markdown, files } = await buildAdventureMarkdown(db, c);
  assert.ok(markdown.startsWith("# Nerevar — Morrowind"));
  assert.ok(markdown.includes("Come back when I have 2,000 gold."));
  assert.ok(markdown.includes("Dear diary. The *ashstorm* again."));
  assert.ok(markdown.includes("**Last known:** Someone in Balmora told me to look near the river."));
  assert.ok(markdown.includes("![the shop](attachments/shot1.png)"));
  assert.deepEqual(files, ["attachments/shot1.png"]);
  assert.ok(!/\n{3,}/.test(markdown));
});

test("backup: export -> restore round trip into an empty database", async () => {
  const { db } = await seed();
  const file = await exportBackup(db, "1.0.0", "2026-10-20T00:00:00Z");
  const json = JSON.parse(JSON.stringify(file));
  const check = checkBackup(json);
  assert.ok(check.ok);
  if (!check.ok) return;
  assert.equal(check.counts.characters, 1);
  assert.deepEqual(referencedFiles(check.file), ["attachments/shot1.png"]);
  const target = await freshDb();
  await repo.createCharacter(target, "skyrim", "Will be replaced");
  await restoreBackup(target, check.file);
  const chars = await repo.listCharacters(target);
  assert.deepEqual(chars.map((x) => x.name), ["Nerevar"]);
  const again = await exportBackup(target, "1.0.0", "2026-10-20T00:00:00Z");
  assert.deepEqual(again.tables, file.tables);
});

test("backup: invalid or newer files are refused and a failed restore changes nothing", async () => {
  assert.equal(checkBackup(null).ok, false);
  assert.equal(checkBackup({ format: "other" }).ok, false);
  const { db } = await seed();
  const file = await exportBackup(db, "1.0.0");
  assert.equal(checkBackup({ ...file, schema: 999 }).ok, false);
  assert.equal(checkBackup({ ...file, tables: { ...file.tables, notes: [{ body: { evil: true } }] } }).ok, false);
  assert.equal(checkBackup({ ...file, tables: { notes: [] } }).ok, false);
  // A row violating a constraint aborts the whole restore.
  const broken = JSON.parse(JSON.stringify(file));
  broken.tables.quests.push({ ...broken.tables.quests[0], id: "qbad", status: "not-a-status" });
  const target = await freshDb();
  const keep = await repo.createCharacter(target, "skyrim", "Keep me");
  await assert.rejects(restoreBackup(target, broken));
  assert.ok(await repo.getCharacter(target, keep));
});

test("resume: recap sentences come only from records", async () => {
  const { db, c } = await seed();
  const s = await repo.startSession(db, c, "live", "2026-10-01T18:00:00.000Z");
  await repo.recordVisit(db, c, { name: "Balmora", exterior: true, gx: -3, gy: -2 }, "live", "2026-10-01T18:10:00.000Z");
  await repo.recordVisit(db, c, { name: "Caldera", exterior: true, gx: -2, gy: 2 }, "live", "2026-10-01T18:40:00.000Z");
  await repo.addEvent(db, c, "quest", "Journal updated: The Missing Informant", "live", {}, "2026-10-01T19:00:00.000Z");
  await repo.setSessionPlace(db, s, "Caldera", "live");
  await repo.endSession(db, s, { nextNote: "Check the buildings.", at: "2026-10-01T20:00:00.000Z" });
  const data = await loadResume(db, c);
  const lines = summarize(data, new Date("2026-10-15T12:00:00Z"));
  const text = lines.join(" ");
  assert.ok(lines[0].startsWith("You last played 2 weeks ago"), lines[0]);
  assert.ok(text.includes("The game last reported you in Caldera."));
  assert.ok(text.includes("Balmora and Caldera"));
  assert.ok(text.includes("“The Missing Informant”"));
  assert.ok(text.includes("You left Cave near Balmora unfinished: “Needed better equipment”"));
  assert.ok(text.includes("Restore Health potions"));
  assert.ok(text.includes("A light source"));
  assert.ok(text.includes("1 reminder waiting."));
  assert.equal(data.session!.nextNote, "Check the buildings.");
});

test("resume: an empty character gets a friendly prompt, not invented history", () => {
  const empty: ResumeData = {
    characterName: "X", session: null, sessionOpen: false, events: [], visits: [], quests: [], delves: [], reminders: [], needs: [], pinned: [], sessionNotes: [], discoveries: [],
  };
  const lines = summarize(empty);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("Nothing recorded yet"));
});
