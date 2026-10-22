// Notes, quests, NPCs, markers, links, profiles, sessions, migrations, search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, nodeDriver } from "./nodeDriver.ts";
import * as repo from "../src/db/repo.ts";
import { migrate, currentVersion, MIGRATIONS, SCHEMA_VERSION } from "../src/db/schema.ts";

test("migrations apply once, are idempotent and refuse newer databases", async () => {
  const db = nodeDriver();
  assert.deepEqual(await migrate(db), MIGRATIONS.map((m) => m.version));
  assert.equal(await currentVersion(db), SCHEMA_VERSION);
  assert.deepEqual(await migrate(db), []);
  // A later migration is applied on top of an existing database.
  const extra = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: "test", sql: ["CREATE TABLE extra_test (x INTEGER)"] }];
  assert.deepEqual(await migrate(db, extra), [SCHEMA_VERSION + 1]);
  assert.equal(await currentVersion(db), SCHEMA_VERSION + 1);
  await assert.rejects(migrate(db), /newer CODEX\.EXE/);
});

test("a failing migration rolls back completely", async () => {
  const db = nodeDriver();
  await migrate(db);
  const bad = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: "bad", sql: ["CREATE TABLE ok_part (x INTEGER)", "THIS IS NOT SQL"] }];
  await assert.rejects(migrate(db, bad));
  assert.equal(await currentVersion(db), SCHEMA_VERSION);
  const t = await db.select("SELECT name FROM sqlite_master WHERE name = 'ok_part'");
  assert.equal(t.length, 0);
});

test("characters in the same game never share records", async () => {
  const db = await freshDb();
  const a = await repo.createCharacter(db, "morrowind", "Nerevar");
  const b = await repo.createCharacter(db, "morrowind", "Second Run");
  await repo.addNote(db, { characterId: a, body: "Come back when I have 2,000 gold." });
  await repo.createQuest(db, a, "The Missing Informant");
  await repo.createNpc(db, a, { name: "Trainer in Balmora" });
  await repo.addMarker(db, a, { mapId: repo.WORLD_MAP, x: -22000, y: -15000, label: "Cave" });
  assert.equal((await repo.listNotes(db, b)).length, 0);
  assert.equal((await repo.listQuests(db, b)).length, 0);
  assert.equal((await repo.listNpcs(db, b)).length, 0);
  assert.equal((await repo.listMarkers(db, b)).length, 0);
  assert.equal((await repo.listNotes(db, a)).length, 1);
  // Deleting a character removes only its own data.
  await repo.deleteCharacter(db, a);
  assert.equal((await repo.listNotes(db, a)).length, 0);
  assert.ok(await repo.getCharacter(db, b));
});

test("notes keep the body exactly as written, tags are cleaned", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const body = "  Dear diary,\n\nI *swear* the guar looked at me funny.  \n- [ ] buy bread\n";
  const id = await repo.addNote(db, { characterId: c, kind: "diary", body, tags: ["#Guar", "guar", " Bread "] });
  const n = (await repo.getNote(db, id))!;
  assert.equal(n.body, body);
  assert.deepEqual(n.tags, ["guar", "bread"]);
  assert.equal(n.kind, "diary");
  await repo.updateNote(db, id, { pinned: true, place: "Balmora" });
  const n2 = (await repo.getNote(db, id))!;
  assert.equal(n2.pinned, true);
  assert.equal(n2.place, "Balmora");
  assert.equal(n2.placeSource, "manual");
  assert.equal(n2.body, body);
});

test("live-located notes record the source", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const id = await repo.addNote(db, { characterId: c, body: "Come back with gold", place: "Balmora", placeSource: "live", wx: -22000, wy: -16000 });
  const n = (await repo.getNote(db, id))!;
  assert.equal(n.placeSource, "live");
  assert.equal(n.wx, -22000);
  const noPlace = await repo.addNote(db, { characterId: c, body: "no place" });
  assert.equal((await repo.getNote(db, noPlace))!.placeSource, null);
});

test("quests: status changes set finish time; deleting removes clues and links", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const q = await repo.createQuest(db, c, "The Missing Informant", { lastKnown: "Someone in Balmora told me to look near the river." });
  await repo.addEntry(db, c, { scope: "quest", parentId: q, kind: "clue", title: "Eastern bank searched" });
  const npc = await repo.createNpc(db, c, { name: "Informant" });
  await repo.link(db, c, { type: "quest", id: q }, { type: "npc", id: npc });
  await repo.updateQuest(db, q, { status: "completed" });
  assert.ok((await repo.getQuest(db, q))!.finishedAt);
  await repo.updateQuest(db, q, { status: "active" });
  assert.equal((await repo.getQuest(db, q))!.finishedAt, null);
  assert.equal((await repo.linksOf(db, "npc", npc)).length, 1);
  await repo.deleteQuest(db, q);
  assert.equal((await repo.listEntries(db, c, "quest")).length, 0);
  assert.equal((await repo.linksOf(db, "npc", npc)).length, 0);
});

test("synced quests match by game id only and never overwrite edited titles", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const manual = await repo.createQuest(db, c, "Report to Caius Cosades");
  const r1 = await repo.upsertSyncedQuest(db, c, { questId: "A1_1_FindSpymaster", index: 1, text: "First entry." });
  assert.equal(r1.created, true);
  assert.equal(r1.title, "a1_1_findspymaster");
  const r2 = await repo.upsertSyncedQuest(db, c, { questId: "a1_1_findspymaster", questName: "Report to Caius Cosades", index: 10, text: "Second." });
  assert.equal(r2.id, r1.id);
  assert.equal(r2.title, "Report to Caius Cosades");
  assert.equal(r2.stageChanged, true);
  // The manual quest with the same title stays separate.
  assert.equal((await repo.listQuests(db, c)).length, 2);
  assert.ok(await repo.getQuest(db, manual));
  await repo.updateQuest(db, r1.id, { title: "My name for it" });
  const r3 = await repo.upsertSyncedQuest(db, c, { questId: "a1_1_findspymaster", questName: "Report to Caius Cosades", index: 10 });
  assert.equal(r3.stageChanged, false);
  assert.equal((await repo.getQuest(db, r1.id))!.title, "My name for it");
  const log = await repo.questLog(db, r1.id);
  assert.deepEqual(log.map((l) => [l.stage, l.text]), [[1, "First entry."], [10, "Second."]]);
  const done = await repo.upsertSyncedQuest(db, c, { questId: "a1_1_findspymaster", index: 100, finished: true });
  assert.equal(done.stageChanged, true);
  assert.equal((await repo.getQuest(db, r1.id))!.status, "completed");
});

test("NPCs, links in both directions and descriptions", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const p = await repo.createNpc(db, c, { name: "Trainer", place: "Balmora", notes: "Couldn't afford the training." });
  const q = await repo.createQuest(db, c, "Q");
  const m = await repo.addMarker(db, c, { mapId: repo.WORLD_MAP, x: 1, y: 2, label: "Trainer's house" });
  const other = await repo.createNpc(db, c, { name: "Brother" });
  await repo.link(db, c, { type: "npc", id: p }, { type: "quest", id: q });
  await repo.link(db, c, { type: "marker", id: m }, { type: "npc", id: p });
  await repo.link(db, c, { type: "npc", id: p }, { type: "npc", id: other }, "brother");
  await repo.link(db, c, { type: "npc", id: p }, { type: "npc", id: p }); // self-links ignored
  const refs = await repo.linksOf(db, "npc", p);
  assert.equal(refs.length, 3);
  const named = await repo.describeRefs(db, refs);
  assert.deepEqual(named.map((r) => r.name).sort(), ["Brother", "Q", "Trainer's house"]);
  assert.equal(named.find((r) => r.name === "Brother")!.label, "brother");
  await repo.unlink(db, { type: "quest", id: q }, { type: "npc", id: p });
  assert.equal((await repo.linksOf(db, "npc", p)).length, 2);
  await repo.updateNpc(db, p, { facts: { asked: "Find my ring", promised: "I said I'd look" } });
  assert.equal((await repo.getNpc(db, p))!.facts.promised, "I said I'd look");
  await repo.deleteMarker(db, m);
  assert.equal((await repo.linksOf(db, "npc", p)).length, 1);
});

test("markers: categories, done flag, map scoping and invalid positions", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const mapId = await repo.createMap(db, c, "morrowind", "image", "Dwemer ruin sketch", "maps/ruin.png");
  const a = await repo.addMarker(db, c, { mapId: repo.WORLD_MAP, x: -10, y: 20, category: "dungeon", label: "Cave I haven't explored" });
  await repo.addMarker(db, c, { mapId, x: 100, y: 50, category: "treasure", label: "Chest" });
  assert.equal((await repo.listMarkers(db, c, repo.WORLD_MAP)).length, 1);
  assert.equal((await repo.listMarkers(db, c, mapId)).length, 1);
  await repo.updateMarker(db, a, { done: true, note: "Cleared" });
  const m = (await repo.getMarker(db, a))!;
  assert.equal(m.done, true);
  assert.equal(m.category, "dungeon");
  await assert.rejects(repo.addMarker(db, c, { mapId: repo.WORLD_MAP, x: NaN, y: 0 }));
  await repo.deleteMap(db, mapId);
  assert.equal((await repo.listMarkers(db, c, mapId)).length, 0);
});

test("sessions: one open session at a time, next-time note and last place", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const s1 = await repo.startSession(db, c, "manual", "2026-10-01T18:00:00.000Z");
  const again = await repo.startSession(db, c, "live", "2026-10-01T18:05:00.000Z");
  assert.equal(again, s1);
  await repo.setSessionPlace(db, s1, "Balmora", "live");
  await repo.endSession(db, s1, { nextNote: "Check the buildings on the western bank.", at: "2026-10-01T20:00:00.000Z" });
  const [s] = await repo.listSessions(db, c);
  assert.equal(s.endedAt, "2026-10-01T20:00:00.000Z");
  assert.equal(s.lastPlace, "Balmora");
  assert.equal(s.lastPlaceSource, "live");
  assert.equal(s.nextNote, "Check the buildings on the western bank.");
  assert.equal((await repo.getCharacter(db, c))!.lastPlayedAt, "2026-10-01T20:00:00.000Z");
  const s2 = await repo.startSession(db, c, "manual");
  assert.notEqual(s2, s1);
});

test("visits count repeat entries and mark the first", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  const r1 = await repo.recordVisit(db, c, { name: "Balmora", exterior: true, gx: -3, gy: -2 }, "live");
  const r2 = await repo.recordVisit(db, c, { name: "Balmora", exterior: true, gx: -3, gy: -2 }, "live");
  const r3 = await repo.recordVisit(db, c, { name: "Balmora, Guild of Mages", exterior: false }, "live");
  assert.equal(r1.first, true);
  assert.equal(r2.first, false);
  assert.equal(r3.key, "int:balmora, guild of mages");
  const v = await repo.listVisits(db, c);
  assert.equal(v.length, 2);
  assert.equal(v.find((x) => x.placeKey === "ext:-3,-2")!.count, 2);
  assert.equal((await repo.listVisits(db, c, { exteriorOnly: true })).length, 1);
});

test("entries keep order per parent; delves cascade their checklist", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "daggerfall", "N");
  const d = await repo.createDelve(db, c, "Castle Wayrest crypts", "Wayrest");
  const e1 = await repo.addEntry(db, c, { scope: "delve", parentId: d, kind: "locked", title: "Iron door, north wing" });
  const e2 = await repo.addEntry(db, c, { scope: "delve", parentId: d, kind: "loot", title: "Left a heavy shield" });
  const list = await repo.listEntries(db, c, "delve", d);
  assert.deepEqual(list.map((e) => e.id), [e1, e2]);
  await repo.updateEntry(db, e1, { done: true });
  assert.deepEqual((await repo.listEntries(db, c, "delve", d)).map((e) => e.id), [e2, e1]);
  await repo.updateDelve(db, d, { status: "left", reason: "Needed better equipment" });
  assert.equal((await repo.listDelves(db, c))[0].status, "left");
  await repo.deleteDelve(db, d);
  assert.equal((await repo.listEntries(db, c, "delve")).length, 0);
});

test("search finds everything the player recorded, ranked by title match", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "N");
  await repo.addNote(db, { characterId: c, body: "The silt strider in Balmora goes to Vivec" });
  await repo.createQuest(db, c, "Balmora errand");
  await repo.createNpc(db, c, { name: "Ajira", place: "Balmora" });
  await repo.addMarker(db, c, { mapId: repo.WORLD_MAP, x: 0, y: 0, label: "Balmora stash" });
  await repo.addEntry(db, c, { scope: "ledger", kind: "storage", title: "Extra armor in a chest", place: "Balmora" });
  await repo.addRoute(db, c, { fromPlace: "Balmora", toPlace: "Vivec", mode: "Silt Strider" });
  await repo.addDiscovery(db, c, { category: "Places", name: "Balmora" });
  const hits = await repo.searchAll(db, c, "balmora");
  const types = new Set(hits.map((h) => h.type));
  for (const t of ["note", "quest", "npc", "marker", "entry", "route", "discovery"]) assert.ok(types.has(t as never), `missing ${t}`);
  assert.equal(hits[0].title.toLowerCase().startsWith("balmora"), true);
  assert.deepEqual(await repo.searchAll(db, c, "b"), []);
  // LIKE wildcards in the query are treated literally.
  assert.deepEqual(await repo.searchAll(db, c, "%%"), []);
  const other = await repo.createCharacter(db, "morrowind", "Other");
  assert.deepEqual(await repo.searchAll(db, other, "balmora"), []);
});

test("settings round-trip JSON values", async () => {
  const db = await freshDb();
  assert.deepEqual(await repo.getSetting(db, "missing", { a: 1 }), { a: 1 });
  await repo.saveSetting(db, "theme", { override: "falloutnv" });
  await repo.saveSetting(db, "theme", { override: "kotor" });
  assert.deepEqual(await repo.getSetting(db, "theme", null), { override: "kotor" });
});

test("archived characters are hidden but kept", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "oblivion", "Hero of Kvatch");
  await repo.updateCharacter(db, c, { archived: true });
  assert.equal((await repo.listCharacters(db)).length, 0);
  assert.equal((await repo.listCharacters(db, true)).length, 1);
});
