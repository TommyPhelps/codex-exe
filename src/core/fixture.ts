/**
 * A replayable, SYNTHETIC bridge session used by the automated tests and by
 * Settings -> Bridge -> "Replay test session". It exercises every message
 * type the bridges send. Place names, quest ids and journal text are
 * deliberately fictional ("Fixture ..."), so it can never be mistaken for
 * real game data. It proves the app's handling of the protocol - not that
 * a real game produces these values.
 */
import type { Engine } from "./protocol.ts";
import { BRIDGE_LINE_PREFIX, PROTOCOL, PROTOCOL_VERSION } from "./protocol.ts";

export interface FixtureStep {
  /** Milliseconds after the replay starts. */
  at: number;
  doc: Record<string, unknown>;
}

const CAPS_FULL = ["cell", "position", "time", "journal", "quests", "character", "stats", "equipment", "spell", "effects", "inventory", "events"];

function character(level: number) {
  return {
    name: "Fixture Hero",
    race: "Fixture Race",
    class: "Fixture Class",
    birthsign: "Fixture Sign",
    level,
    health: { base: 60, current: 54 },
    magicka: { base: 80, current: 80 },
    fatigue: { base: 200, current: 190 },
    gold: 420,
    attributes: { strength: { base: 40, current: 40 }, intelligence: { base: 55, current: 60 } },
    skills: { Alchemy: { base: 32, current: 32 }, Athletics: { base: 25, current: 25 } },
    equipped: ["Fixture Robe", "Fixture Shoes"],
    spell: "Fixture Light",
    effects: ["Fixture Glow"],
    inventory: [
      { name: "Fixture Robe", count: 1 },
      { name: "Fixture Potion", count: 3 },
    ],
  };
}

/**
 * Exterior cells use a fictional 8192-unit grid around (10, 10). A "teleport"
 * jump in the middle checks that fast travel never draws a straight line.
 */
export function fixtureSession(engine: Engine = "mwse", session = "fixture0001"): FixtureStep[] {
  const steps: FixtureStep[] = [];
  let seq = 0;
  let eventSeq = 0;
  const events: Record<string, unknown>[] = [];
  const time = (hour: number) => ({ year: 427, month: 8, day: 16, hour });
  const push = (at: number, state: Record<string, unknown> | null, newEvents: Record<string, unknown>[] = []) => {
    for (const e of newEvents) events.push({ ...e, seq: ++eventSeq });
    seq++;
    const doc: Record<string, unknown> = {
      protocol: PROTOCOL,
      v: PROTOCOL_VERSION,
      engine,
      session,
      seq,
      caps: CAPS_FULL,
      engineVersion: engine === "mwse" ? "MWSE fixture" : "OpenMW fixture",
    };
    if (state) doc.state = state;
    // MWSE keeps a ring buffer; OpenMW sends only new events per line.
    doc.events = engine === "mwse" ? events.slice(-120) : newEvents.map((e, i) => ({ ...e, seq: eventSeq - newEvents.length + i + 1 }));
    steps.push({ at, doc });
  };
  const ext = (gx: number, gy: number, name = "") => ({ name, exterior: true, gx, gy, region: "Fixture Region" });
  const walk = (x: number, y: number, cell: object, h: number, menu = false) => ({
    menu,
    cell,
    pos: { x, y, z: 120, yaw: 1.2 },
    time: time(h),
    character: character(3),
  });

  push(0, { menu: true }, [{ kind: "hello", caps: CAPS_FULL, engineVersion: "fixture" }]);
  push(500, walk(82000, 82000, ext(10, 10, "Fixture Town"), 9), [
    { kind: "loaded", save: "Fixture save", newGame: false },
    {
      kind: "quests",
      list: [
        { questId: "codex_fixture_errand", questName: "Fixture Errand", index: 10, text: "Fixture journal entry: an errand began (synthetic).", finished: false },
      ],
    },
  ]);
  // Walk east through two cells.
  let x = 82000;
  for (let i = 1; i <= 8; i++) {
    x += 1100;
    const gx = Math.floor(x / 8192);
    push(500 + i * 1500, walk(x, 82000, ext(gx, 10, gx === 10 ? "Fixture Town" : ""), 9 + i * 0.02));
  }
  // Enter an interior: no world position may be drawn.
  push(14000, { ...walk(0, 0, { name: "Fixture Town, Tower", exterior: false }, 9.3) }, [
    { kind: "cell", cell: { name: "Fixture Town, Tower", exterior: false } },
  ]);
  push(15500, { ...walk(256, 512, { name: "Fixture Town, Tower", exterior: false }, 9.31) }, [
    { kind: "journal", questId: "codex_fixture_errand", questName: "Fixture Errand", index: 20, text: "Fixture journal entry: the errand moved on (synthetic).", finished: false, isNew: false },
  ]);
  // Back outside, then a pause menu (nothing recorded), then a teleport far away.
  push(17000, walk(91000, 82100, ext(11, 10), 9.4), [{ kind: "cell", cell: ext(11, 10) }]);
  push(18500, walk(91000, 82100, ext(11, 10), 9.4, true));
  push(20000, walk(91600, 82100, ext(11, 10), 9.42));
  push(21500, walk(155000, 120000, ext(18, 14, "Fixture Port"), 9.5), [{ kind: "teleport" }, { kind: "cell", cell: ext(18, 14, "Fixture Port") }]);
  push(23000, walk(155900, 120000, ext(18, 14, "Fixture Port"), 9.52), [{ kind: "levelUp", level: 4 }, { kind: "skillRaised", skill: "Athletics", level: 26 }]);
  push(24500, walk(156800, 120100, ext(19, 14, ""), 9.55), [
    { kind: "journal", questId: "codex_fixture_errand", questName: "Fixture Errand", index: 100, text: "Fixture journal entry: the errand is complete (synthetic).", finished: true, isNew: false },
    { kind: "saved", save: "Fixture save 2" },
  ]);
  return steps;
}

/** The same session as openmw.log lines (with the engine's log prefix noise). */
export function fixtureLogLines(session = "fixture0002"): string[] {
  return fixtureSession("openmw", session).map(
    (s, i) => `[12:00:${String(i).padStart(2, "0")}.000 I] scripts/codex_bridge/player.lua:\t${BRIDGE_LINE_PREFIX}${JSON.stringify(s.doc)}`,
  );
}
