/**
 * Turns validated bridge messages into companion actions (pure, testable).
 *
 * Rules that keep the record honest:
 *  - Trail points are only recorded in exterior cells, outside menus, and
 *    only when the player actually moved.
 *  - A new trail segment starts after loading, door transitions (any interior
 *    visit), teleport events, or a jump too fast to be walking - so fast
 *    travel never draws a straight line across the map.
 *  - Interiors never produce a world-map position.
 */
import type { BridgeEvent, BridgeMessage, Cap, Engine, LiveCell, LiveState, QuestSnapshot } from "./protocol.ts";
import { cellLabel, placeKey } from "./protocol.ts";

export const FRESH_MS = 20_000;
export const MIN_STEP_UNITS = 192;
/** Faster than this between samples is treated as a teleport, not a walk. */
export const MAX_TRAVEL_SPEED = 2_500; // world units per second
export const JUMP_UNITS = 4_096;
export const SAMPLE_GAP_MS = 60_000;

export interface Tracker {
  session: string | null;
  engine: Engine | null;
  engineVersion: string | null;
  caps: Cap[];
  lastMsgSeq: number;
  lastEventSeq: number;
  lastMsgAt: number | null;
  state: LiveState | null;
  lastCellKey: string | null;
  seg: number;
  lastPoint: { x: number; y: number; at: number } | null;
  breakNext: boolean;
}

export type Action =
  | { type: "session"; engine: Engine; session: string }
  | { type: "state"; state: LiveState }
  | { type: "visit"; cell: LiveCell }
  | { type: "trail"; x: number; y: number; seg: number }
  | { type: "journal"; questId: string; questName?: string; index: number; text?: string; finished?: boolean }
  | { type: "quests"; list: QuestSnapshot[] }
  | { type: "loaded"; save?: string; newGame?: boolean }
  | { type: "saved"; save?: string }
  | { type: "timeline"; kind: string; summary: string };

export function newTracker(seg = 0): Tracker {
  return {
    session: null,
    engine: null,
    engineVersion: null,
    caps: [],
    lastMsgSeq: -1,
    lastEventSeq: -1,
    lastMsgAt: null,
    state: null,
    lastCellKey: null,
    seg,
    lastPoint: null,
    breakNext: true,
  };
}

function eventActions(t: Tracker, ev: BridgeEvent, out: Action[]): void {
  switch (ev.kind) {
    case "hello":
      if (ev.caps.length) t.caps = ev.caps;
      if (ev.engineVersion) t.engineVersion = ev.engineVersion;
      break;
    case "loaded":
      t.breakNext = true;
      t.lastCellKey = null;
      out.push({ type: "loaded", save: ev.save, newGame: ev.newGame });
      break;
    case "saved":
      out.push({ type: "saved", save: ev.save });
      break;
    case "teleport":
      t.breakNext = true;
      break;
    case "cell":
      // Cell changes are also derived from state; the event makes them prompt.
      noteCell(t, ev.cell, out);
      break;
    case "journal":
      out.push({
        type: "journal",
        questId: ev.questId,
        questName: ev.questName,
        index: ev.index,
        text: ev.text,
        finished: ev.finished,
      });
      break;
    case "quests":
      if (ev.list.length) out.push({ type: "quests", list: ev.list });
      break;
    case "levelUp":
      out.push({ type: "timeline", kind: "level", summary: `Reached level ${ev.level}` });
      break;
    case "skillRaised":
      out.push({ type: "timeline", kind: "skill", summary: `${ev.skill} rose to ${ev.level}` });
      break;
  }
}

function noteCell(t: Tracker, cell: LiveCell, out: Action[]): void {
  const key = placeKey(cell);
  if (key === t.lastCellKey) return;
  const wasExterior = t.lastCellKey?.startsWith("ext:") ?? false;
  t.lastCellKey = key;
  if (!cell.exterior || !wasExterior) t.breakNext = true;
  out.push({ type: "visit", cell });
}

/** Decide whether a new position becomes a trail point (and whether it starts a segment). */
export function trailStep(
  t: Pick<Tracker, "lastPoint" | "breakNext" | "seg">,
  x: number,
  y: number,
  at: number,
): { record: boolean; newSegment: boolean } {
  if (t.breakNext || !t.lastPoint) return { record: true, newSegment: true };
  const dx = x - t.lastPoint.x;
  const dy = y - t.lastPoint.y;
  const dist = Math.hypot(dx, dy);
  const dt = Math.max(0.001, (at - t.lastPoint.at) / 1000);
  if (at - t.lastPoint.at > SAMPLE_GAP_MS) return { record: true, newSegment: true };
  if (dist > JUMP_UNITS && dist / dt > MAX_TRAVEL_SPEED) return { record: true, newSegment: true };
  if (dist < MIN_STEP_UNITS) return { record: false, newSegment: false };
  return { record: true, newSegment: false };
}

/** Feeds one validated message into the tracker. Returns the actions to apply. */
export function ingest(t: Tracker, msg: BridgeMessage, now: number): Action[] {
  const out: Action[] = [];
  if (msg.session !== t.session) {
    t.session = msg.session;
    t.engine = msg.engine;
    t.lastMsgSeq = -1;
    t.lastEventSeq = -1;
    t.breakNext = true;
    t.lastCellKey = null;
    t.caps = [];
    out.push({ type: "session", engine: msg.engine, session: msg.session });
  }
  if (msg.seq <= t.lastMsgSeq) return out; // unchanged file re-read
  t.lastMsgSeq = msg.seq;
  t.lastMsgAt = now;
  if (msg.caps && msg.caps.length) t.caps = msg.caps;
  if (msg.engineVersion) t.engineVersion = msg.engineVersion;

  for (const { seq, event } of msg.events) {
    if (seq <= t.lastEventSeq) continue;
    t.lastEventSeq = seq;
    eventActions(t, event, out);
  }

  const s = msg.state;
  if (s) {
    t.state = s;
    out.push({ type: "state", state: s });
    if (s.cell && !s.menu) noteCell(t, s.cell, out);
    if (s.cell && s.cell.exterior && s.pos && !s.menu) {
      const step = trailStep(t, s.pos.x, s.pos.y, now);
      if (step.record) {
        if (step.newSegment) t.seg += 1;
        t.breakNext = false;
        t.lastPoint = { x: s.pos.x, y: s.pos.y, at: now };
        out.push({ type: "trail", x: s.pos.x, y: s.pos.y, seg: t.seg });
      }
    } else if (s.cell && !s.cell.exterior) {
      t.breakNext = true;
    }
  }
  return out;
}

// ------------------------------------------------------------- connection

export type ConnState = "live" | "limited" | "waiting" | "manual" | "not-running";

export interface ConnInput {
  configured: boolean;
  processRunning: boolean;
  lastMsgAt: number | null;
  caps: Cap[];
}

export interface ConnStatus {
  state: ConnState;
  label: string;
  detail: string;
}

const LIVE_CAPS: Cap[] = ["cell", "position", "journal"];

export function connectionStatus(c: ConnInput, now: number): ConnStatus {
  const fresh = c.lastMsgAt !== null && now - c.lastMsgAt < FRESH_MS;
  if (fresh) {
    const full = LIVE_CAPS.every((cap) => c.caps.includes(cap));
    return full
      ? { state: "live", label: "Connected — live", detail: "Location, journal and character data are arriving from the game." }
      : {
          state: "limited",
          label: "Connected — limited information",
          detail: `The bridge only reports: ${c.caps.length ? c.caps.join(", ") : "basic status"}.`,
        };
  }
  if (!c.configured) {
    return c.processRunning
      ? { state: "manual", label: "Manual mode", detail: "The game is running. No bridge is set up, so everything you record is entered by you." }
      : { state: "manual", label: "Manual mode", detail: "No bridge is set up. Everything works; values are entered by you." }
  }
  if (c.processRunning) {
    return {
      state: "waiting",
      label: "Waiting for the bridge",
      detail: "The game is running but no bridge data has arrived yet. Load a save, or check the bridge setup in Settings.",
    };
  }
  return { state: "not-running", label: "Game not running", detail: "Your notes and maps are all available. Live data resumes when you play." };
}

export function describeCell(cell: LiveCell | undefined): string {
  return cellLabel(cell);
}
