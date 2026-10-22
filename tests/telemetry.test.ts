// Bridge protocol validation, the live tracker, connection status and sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBridgeDocument, parseBridgeLines, validateDocument, placeKey, cellLabel } from "../src/core/protocol.ts";
import { ingest, newTracker, connectionStatus, trailStep, FRESH_MS } from "../src/core/live.ts";
import type { Action } from "../src/core/live.ts";
import { fixtureSession, fixtureLogLines } from "../src/core/fixture.ts";
import { applyActions, resolveSyncCharacter, gameDateLabel } from "../src/core/sync.ts";
import { freshDb } from "./nodeDriver.ts";
import * as repo from "../src/db/repo.ts";

const base = { protocol: "codex-bridge", v: 1, engine: "mwse", session: "abc123", seq: 1 };

test("rejects documents that are not bridge documents", () => {
  assert.equal(parseBridgeDocument("{").ok, false);
  assert.equal(parseBridgeDocument("[]").ok, false);
  assert.equal(parseBridgeDocument(JSON.stringify({ ...base, protocol: "other" })).ok, false);
  assert.equal(parseBridgeDocument(JSON.stringify({ ...base, v: 2 })).ok, false);
  assert.equal(parseBridgeDocument(JSON.stringify({ ...base, engine: "skyrim" })).ok, false);
  assert.equal(parseBridgeDocument(JSON.stringify({ ...base, session: "../../etc" })).ok, false);
  assert.equal(parseBridgeDocument(JSON.stringify({ ...base, seq: "1" })).ok, false);
  assert.equal(parseBridgeDocument("x".repeat(2_000_001)).ok, false);
});

test("validates and clamps state fields; drops unknown or malformed events", () => {
  const r = validateDocument({
    ...base,
    caps: ["cell", "position", "bogus"],
    state: {
      menu: false,
      cell: { name: "Balmora\u0007", exterior: true, gx: -3, gy: -2, region: "West Gash Region" },
      pos: { x: -22000.5, y: -15000, z: 600, yaw: 1.5 },
      time: { year: 427, month: 8, day: 16, hour: 13.5, daysPassed: 9 },
      character: { name: "N", level: 3, attributes: { strength: { base: 40, current: 42 }, bad: { base: "x" } }, inventory: [{ name: "Gold", count: 5 }, { nope: 1 }] },
    },
    events: [
      { seq: 2, kind: "journal", questId: "q1", index: 10, text: "t" },
      { seq: 1, kind: "cell", cell: { name: "Seyda Neen", exterior: true, gx: -2, gy: -9 } },
      { seq: 3, kind: "launchMissiles" },
      { seq: 4, kind: "cell", cell: { name: "x", exterior: true } },
      { kind: "levelUp", level: 2 },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const m = r.msg;
  assert.deepEqual(m.caps, ["cell", "position"]);
  assert.equal(m.state!.cell!.name, "Balmora");
  assert.equal(m.state!.time!.month, 8);
  assert.deepEqual(Object.keys(m.state!.character!.attributes!), ["strength"]);
  assert.equal(m.state!.character!.inventory!.length, 1);
  assert.deepEqual(m.events.map((e) => e.seq), [1, 2]);
  assert.equal(m.dropped, 3);
});

test("an exterior cell without grid coordinates is refused (no false world position)", () => {
  const r = validateDocument({ ...base, state: { menu: false, cell: { name: "Somewhere", exterior: true } } });
  assert.ok(r.ok && r.msg.state && !r.msg.state.cell);
});

test("non-finite and out-of-range numbers are rejected", () => {
  const r = validateDocument({ ...base, state: { menu: false, pos: { x: 1e12, y: 0, z: 0 }, time: { month: 13, day: 0 } } });
  assert.ok(r.ok && !r.msg.state!.pos && !r.msg.state!.time);
});

test("openmw log lines: only prefixed lines are read", () => {
  const lines = ["[12:00:00.000 I] Loading cell...", ...fixtureLogLines(), "garbage CODEXBRIDGE1 {broken"];
  const { messages, errors } = parseBridgeLines(lines);
  assert.equal(messages.length, fixtureSession("openmw").length);
  assert.equal(errors, 1);
  assert.equal(messages[0].engine, "openmw");
});

test("place keys and labels", () => {
  assert.equal(placeKey({ name: "", exterior: true, gx: 1, gy: -2 }), "ext:1,-2");
  assert.equal(placeKey({ name: "Balmora, Guild of Mages", exterior: false }), "int:balmora, guild of mages");
  assert.equal(cellLabel({ name: "", exterior: true, gx: 1, gy: 2, region: "Ascadian Isles Region" }), "Ascadian Isles Region (1, 2)");
});

function replay(engine: "mwse" | "openmw") {
  const t = newTracker();
  const all: Action[] = [];
  const steps = fixtureSession(engine);
  for (const s of steps) {
    const r = validateDocument(s.doc);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) all.push(...ingest(t, r.msg, 1_000_000 + s.at));
  }
  return { t, all };
}

for (const engine of ["mwse", "openmw"] as const) {
  test(`fixture replay (${engine}): trail segments break on interiors and teleports, not on pauses`, () => {
    const { all } = replay(engine);
    const trail = all.filter((a): a is Extract<Action, { type: "trail" }> => a.type === "trail");
    const segs = [...new Set(trail.map((p) => p.seg))];
    // Segment 1: outdoor walk. 2: after leaving the interior. 3: after the teleport.
    assert.equal(segs.length, 3, JSON.stringify(trail));
    // No trail point is ever recorded at interior coordinates.
    assert.ok(trail.every((p) => p.x > 50_000));
    // The paused sample (menu) at the same spot did not add a point.
    const seg2 = trail.filter((p) => p.seg === segs[1]);
    assert.equal(seg2.length, 2);
    // Teleport: the far point starts a new segment rather than extending the old one.
    assert.equal(trail.find((p) => p.x === 155000)!.seg, segs[2]);
  });

  test(`fixture replay (${engine}): journal, quests, visits and timeline actions`, () => {
    const { all, t } = replay(engine);
    const journals = all.filter((a) => a.type === "journal");
    assert.equal(journals.length, 2);
    assert.equal(all.filter((a) => a.type === "quests").length, 1);
    const visits = all.filter((a): a is Extract<Action, { type: "visit" }> => a.type === "visit").map((v) => cellLabel(v.cell));
    assert.ok(visits.includes("Fixture Town, Tower"));
    assert.ok(visits.includes("Fixture Port"));
    assert.ok(all.some((a) => a.type === "timeline" && a.summary === "Reached level 4"));
    assert.ok(t.caps.includes("journal"));
  });
}

test("re-reading an unchanged MWSE file produces nothing new", () => {
  const t = newTracker();
  const doc = fixtureSession("mwse")[3].doc;
  const r = validateDocument(doc);
  assert.ok(r.ok);
  if (!r.ok) return;
  ingest(t, r.msg, 1000);
  assert.deepEqual(ingest(t, r.msg, 2000), []);
});

test("a new bridge session (game restart) resets sequence tracking", () => {
  const t = newTracker();
  const a = validateDocument({ ...base, session: "one", seq: 50, events: [{ seq: 9, kind: "levelUp", level: 9 }] });
  const b = validateDocument({ ...base, session: "two", seq: 1, events: [{ seq: 1, kind: "levelUp", level: 10 }] });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  ingest(t, a.msg, 0);
  const out = ingest(t, b.msg, 10);
  assert.equal(out[0].type, "session");
  assert.ok(out.some((x) => x.type === "timeline" && x.summary === "Reached level 10"));
});

test("trailStep thresholds", () => {
  const t = { lastPoint: { x: 0, y: 0, at: 0 }, breakNext: false, seg: 1 };
  assert.deepEqual(trailStep(t, 50, 0, 1500), { record: false, newSegment: false });
  assert.deepEqual(trailStep(t, 500, 0, 1500), { record: true, newSegment: false });
  assert.deepEqual(trailStep(t, 50_000, 0, 1500), { record: true, newSegment: true });
  // Very fast but tiny distance (e.g. levitation burst) is still continuous.
  assert.deepEqual(trailStep(t, 3000, 0, 500), { record: true, newSegment: false });
  assert.deepEqual(trailStep(t, 500, 0, 120_000), { record: true, newSegment: true });
});

test("connection status covers the four states plus waiting", () => {
  const now = 100_000;
  assert.equal(connectionStatus({ configured: false, processRunning: false, lastMsgAt: null, caps: [] }, now).state, "manual");
  assert.equal(connectionStatus({ configured: true, processRunning: false, lastMsgAt: null, caps: [] }, now).state, "not-running");
  assert.equal(connectionStatus({ configured: true, processRunning: true, lastMsgAt: null, caps: [] }, now).state, "waiting");
  assert.equal(connectionStatus({ configured: true, processRunning: true, lastMsgAt: now - 1000, caps: ["cell", "position", "journal"] }, now).state, "live");
  assert.equal(connectionStatus({ configured: true, processRunning: true, lastMsgAt: now - 1000, caps: ["cell", "position"] }, now).state, "limited");
  // Stale data is not reported as live.
  assert.equal(connectionStatus({ configured: true, processRunning: false, lastMsgAt: now - FRESH_MS - 1, caps: ["cell", "position", "journal"] }, now).state, "not-running");
});

test("sync writes visits, trail, quests, discoveries and timeline for the bound character only", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "Fixture Hero");
  const other = await repo.createCharacter(db, "morrowind", "Someone else");
  const session = await repo.startSession(db, c, "live");
  const { all } = replay("mwse");
  const res = await applyActions(db, { characterId: c, sessionId: session, time: { year: 427, month: 8, day: 16 } }, all);
  assert.ok(res.changed);
  const quests = await repo.listQuests(db, c);
  assert.equal(quests.length, 1);
  assert.equal(quests[0].title, "Fixture Errand");
  assert.equal(quests[0].status, "completed");
  assert.equal(quests[0].source, "sync");
  const log = await repo.questLog(db, quests[0].id);
  assert.deepEqual(log.map((l) => l.stage), [10, 20, 100]);
  const visits = await repo.listVisits(db, c);
  assert.ok(visits.some((v) => v.name === "Fixture Town, Tower" && v.interior && v.source === "live"));
  const trail = await repo.listTrail(db, c);
  assert.ok(trail.length > 5);
  const disc = await repo.listDiscoveries(db, c);
  assert.ok(disc.every((d) => d.source === "sync"));
  assert.ok(disc.some((d) => d.name === "Fixture Port"));
  // Wilderness cells do not become named discoveries.
  assert.ok(!disc.some((d) => d.name === ""));
  const events = await repo.listEvents(db, c);
  assert.ok(events.some((e) => e.summary === "Reached level 4" && e.source === "live"));
  const [s] = await repo.listSessions(db, c);
  assert.equal(s.lastPlaceSource, "live");
  assert.equal((await repo.listQuests(db, other)).length, 0);
  assert.equal((await repo.listVisits(db, other)).length, 0);
});

test("place and level reminders trigger from live data", async () => {
  const db = await freshDb();
  const c = await repo.createCharacter(db, "morrowind", "Fixture Hero");
  const r1 = await repo.addEntry(db, c, { scope: "reminder", kind: "place", title: "Visit the shop", place: "fixture port" });
  const r2 = await repo.addEntry(db, c, { scope: "reminder", kind: "level", title: "Return to the trainer" });
  await repo.addEntry(db, c, { scope: "reminder", kind: "place", title: "Elsewhere", place: "Nowhere" });
  const { all } = replay("mwse");
  const res = await applyActions(db, { characterId: c, sessionId: null }, all);
  assert.deepEqual(res.reminders.sort(), [r1, r2].sort());
});

test("live data is never merged into a character automatically", async () => {
  const db = await freshDb();
  const a = await repo.createCharacter(db, "morrowind", "Fixture Hero");
  const b = await repo.createCharacter(db, "morrowind", "Fixture Hero");
  let chars = await repo.listCharacters(db);
  assert.equal(resolveSyncCharacter(chars, "morrowind", "Fixture Hero").status, "unbound");
  await repo.updateCharacter(db, a, { syncName: "Fixture Hero" });
  chars = await repo.listCharacters(db);
  assert.deepEqual(resolveSyncCharacter(chars, "morrowind", "fixture hero"), { status: "bound", characterId: a });
  assert.equal(resolveSyncCharacter(chars, "oblivion", "Fixture Hero").status, "unbound");
  await repo.updateCharacter(db, b, { syncName: "Fixture Hero" });
  chars = await repo.listCharacters(db);
  assert.equal(resolveSyncCharacter(chars, "morrowind", "Fixture Hero").status, "ambiguous");
  assert.deepEqual(resolveSyncCharacter(chars, "morrowind", "Fixture Hero", b), { status: "bound", characterId: b });
});

test("game date labels", () => {
  assert.equal(gameDateLabel({ year: 427, month: 8, day: 16 }), "16 Last Seed, 3E 427");
  assert.equal(gameDateLabel({ hour: 3 }), null);
});
