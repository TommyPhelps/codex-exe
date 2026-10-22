/**
 * The live-data service: receives bridge output from Rust, validates it,
 * feeds the tracker, writes verified facts for the linked character and keeps
 * the connection status honest.
 */
import { getState, setState, setLive, bump, toast, db, activeCharacter } from "../state/store.ts";
import * as native from "../platform/native.ts";
import * as repo from "../db/repo.ts";
import { parseBridgeDocument, parseBridgeLines, cellLabel } from "../core/protocol.ts";
import type { BridgeMessage, LiveState } from "../core/protocol.ts";
import { connectionStatus, ingest, newTracker } from "../core/live.ts";
import type { Tracker, Action } from "../core/live.ts";
import { applyActions, resolveSyncCharacter } from "../core/sync.ts";
import { GAMES, gameById, gameForExecutable } from "../core/games.ts";
import { fixtureSession } from "../core/fixture.ts";
import { bridgeConfig } from "./prefs.ts";
import { selectCharacter } from "./actions.ts";

interface Cursor {
  session: string;
  seq: number;
  eventSeq: number;
}

let tracker: Tracker = newTracker();
let queue: Promise<void> = Promise.resolve();
let lastLiveSave = 0;
let lastSavedCell = "";
let replayTimers: ReturnType<typeof setTimeout>[] = [];
let replaying = false;
let noticeId = 0;
/** Actions received while the in-game character is not linked yet (applied once linked). */
let pending: Action[] = [];
let unlisten: (() => void)[] = [];
let statusTimer: ReturnType<typeof setInterval> | null = null;

/** The game whose bridge is configured (only Morrowind has bridges today). */
function bridgedGameId(): string | null {
  const ch = activeCharacter();
  if (ch && gameById(ch.gameId).bridges.length && bridgeConfig(ch.gameId).engine !== "none") return ch.gameId;
  for (const g of GAMES) if (g.bridges.length && bridgeConfig(g.id).engine !== "none") return g.id;
  return null;
}

export async function configureBridge(): Promise<void> {
  if (!native.isDesktop()) return;
  const gid = bridgedGameId();
  const sources: { engine: string; path: string }[] = [];
  if (gid) {
    const cfg = bridgeConfig(gid);
    if (cfg.engine === "mwse" && cfg.gameDir) sources.push({ engine: "mwse", path: `${cfg.gameDir.replace(/[\\/]+$/, "")}\\Data Files\\MWSE\\codex_live.json` });
    if (cfg.engine === "openmw" && cfg.logPath) sources.push({ engine: "openmw", path: cfg.logPath });
  }
  await native.bridgeSetSources(sources).catch(() => {});
  const extra = getState().prefs.extraExecutables;
  const exes = GAMES.flatMap((g) => [...g.executables, ...(extra[g.id] ?? [])]);
  const running = await native.setWatchedExecutables(exes).catch(() => [] as string[]);
  setLive({ running });
  refreshStatus();
}

export function refreshStatus(): void {
  const s = getState();
  if (replaying) return;
  const gid = bridgedGameId();
  const running = s.live.running.length > 0;
  const status = connectionStatus({ configured: gid !== null, processRunning: running, lastMsgAt: tracker.lastMsgAt, caps: tracker.caps }, Date.now());
  if (status.label !== s.live.status.label || status.detail !== s.live.status.detail) setLive({ status });
}

async function cursorFor(engine: string): Promise<Cursor | null> {
  return repo.getSetting<Cursor | null>(db(), `bridgeCursor:${engine}`, null);
}

async function saveCursor(engine: string, c: Cursor): Promise<void> {
  await repo.saveSetting(db(), `bridgeCursor:${engine}`, c);
}

function pushNotice(text: string): void {
  const id = ++noticeId;
  setState((s) => ({ live: { ...s.live, notices: [...s.live.notices.slice(-4), { id, text, at: Date.now() }] } }));
  setTimeout(() => setState((s) => ({ live: { ...s.live, notices: s.live.notices.filter((n) => n.id !== id) } })), 9000);
}

async function handleMessage(msg: BridgeMessage, mtimeMs: number): Promise<void> {
  if (tracker.session !== msg.session) {
    const cursor = await cursorFor(msg.engine);
    if (cursor && cursor.session === msg.session) {
      // Same game session as before an app restart: resume after what was applied.
      tracker.session = msg.session;
      tracker.engine = msg.engine;
      tracker.lastMsgSeq = cursor.seq;
      tracker.lastEventSeq = cursor.eventSeq;
      tracker.breakNext = true;
      if (msg.state) setLive({ state: msg.state });
    }
  }
  const at = Math.min(Date.now(), mtimeMs || Date.now());
  const actions = ingest(tracker, msg, at);
  if (!actions.length) return;
  setLive({ engine: tracker.engine, engineVersion: tracker.engineVersion, caps: tracker.caps, lastAt: tracker.lastMsgAt, state: tracker.state });
  refreshStatus();

  const gid = "morrowind";
  const name = tracker.state?.character?.name;
  let characterId: string | null = null;
  if (name) {
    const s = getState();
    const preferred = await repo.getSetting<string | null>(db(), `syncChoice:${name.toLowerCase()}`, null);
    const binding = resolveSyncCharacter(s.characters, gid, name, preferred);
    if (binding.status === "bound") {
      characterId = binding.characterId;
      if (s.live.binding) setLive({ binding: null });
      if (s.activeId !== characterId) {
        await selectCharacter(characterId);
        toast(`Showing ${s.characters.find((c) => c.id === characterId)?.name ?? "your character"} \u2014 the game is playing as ${name}.`);
      }
    } else if (JSON.stringify(s.live.binding) !== JSON.stringify(binding)) {
      setLive({ binding });
    }
  }
  if (!characterId) {
    // Nothing is written until the player links this in-game character.
    pending = [...pending, ...actions.filter((a) => a.type !== "state")].slice(-3000);
    return;
  }
  const all = pending.length ? [...pending, ...actions] : actions;
  pending = [];
  await applyFor(characterId, all);
  await saveCursor(msg.engine, { session: msg.session, seq: tracker.lastMsgSeq, eventSeq: tracker.lastEventSeq });
}

async function applyFor(characterId: string, actions: Action[]): Promise<void> {
  // Sessions follow the game: a load (or the first data) opens one.
  let sessionId = getState().sessionId;
  if (actions.some((a) => a.type === "loaded" || a.type === "session") || !sessionId) {
    const open = await repo.openSession(db(), characterId);
    sessionId = open?.id ?? (await repo.startSession(db(), characterId, "live"));
    setState({ sessionId });
  }
  const res = await applyActions(db(), { characterId, sessionId, time: tracker.state?.time }, actions);
  await saveLiveSnapshot(characterId, tracker.state);
  for (const n of res.notices) pushNotice(n);
  if (res.reminders.length) setLive({ reminders: [...new Set([...getState().live.reminders, ...res.reminders])] });
  if (res.changed) bump();
}

async function saveLiveSnapshot(characterId: string, st: LiveState | null): Promise<void> {
  if (!st) return;
  const cell = cellLabel(st.cell);
  const now = Date.now();
  if (now - lastLiveSave < 15000 && cell === lastSavedCell) return;
  lastLiveSave = now;
  lastSavedCell = cell;
  await repo.saveLive(db(), characterId, { ...st, receivedAt: new Date(now).toISOString(), engine: tracker.engine, engineVersion: tracker.engineVersion });
}

function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch((e) => {
    console.error("bridge", e);
  });
}

async function onProcesses(running: string[]): Promise<void> {
  const before = getState().live.running;
  setLive({ running });
  refreshStatus();
  const s = getState();
  // Game closed: end the open live session (the player can add a "next time" note on the recap page).
  if (before.length > 0 && running.length === 0 && s.sessionId) {
    const sid = s.sessionId;
    const st = s.live.state;
    await repo.endSession(db(), sid, { lastPlace: st?.cell ? cellLabel(st.cell) : null, lastPlaceSource: st?.cell ? "live" : null });
    setState({ sessionId: null });
    bump();
    pushNotice("Game closed — session saved. Add a “next time” note on the recap page.");
  }
  // Game opened: switch to that game's most recent character (theme follows).
  const started = running.find((r) => !before.includes(r));
  if (started) {
    const g = gameForExecutable(started, s.prefs.extraExecutables);
    const ch = activeCharacter(s);
    if (g && ch?.gameId !== g.id) {
      const candidate = s.characters.find((c) => c.gameId === g.id && !c.archived);
      if (candidate) {
        await selectCharacter(candidate.id);
        toast(`${g.short} is running — switched to ${candidate.name}.`);
      } else {
        toast(`${g.short} is running. Create a ${g.short} character in Settings to start its journal.`);
      }
    }
  }
}

export async function startLive(): Promise<void> {
  for (const u of unlisten) u();
  unlisten = [];
  unlisten.push(
    await native.listen<{ engine: string; text: string; mtimeMs: number }>("bridge-doc", (p) => {
      const r = parseBridgeDocument(p.text);
      if (r.ok) enqueue(() => handleMessage(r.msg, p.mtimeMs));
    }),
  );
  unlisten.push(
    await native.listen<{ engine: string; lines: string[]; mtimeMs: number }>("bridge-lines", (p) => {
      const { messages } = parseBridgeLines(p.lines);
      for (const m of messages) enqueue(() => handleMessage(m, p.mtimeMs));
    }),
  );
  unlisten.push(await native.listen<string[]>("processes", (running) => enqueue(() => onProcesses(running))));
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, 2000);
  await configureBridge();
}

/** Link the in-game character name to a CODEX character (explicit user choice). */
export async function linkSyncName(characterId: string, syncName: string): Promise<void> {
  await repo.updateCharacter(db(), characterId, { syncName });
  await repo.saveSetting(db(), `syncChoice:${syncName.toLowerCase()}`, characterId);
  const characters = await repo.listCharacters(db(), true);
  setState({ characters: characters.filter((c) => !c.archived) });
  setLive({ binding: null });
  toast(`Live data from “${syncName}” now goes to this character.`, "ok");
}

export function dismissBinding(): void {
  setLive({ binding: null });
}

// ------------------------------------------------------------------ replay

/**
 * Plays the synthetic fixture session into the live display only. Nothing is
 * written to the database, and the status says it is test data.
 */
export function startReplay(): void {
  stopReplay();
  replaying = true;
  const t = newTracker();
  const steps = fixtureSession("mwse", `replay${Date.now().toString(36)}`);
  const trail: { x: number; y: number; seg: number }[] = [];
  setLive({ status: { state: "limited", label: "Replay — test data", detail: "Showing the synthetic test session. Nothing is saved." } });
  for (const step of steps) {
    replayTimers.push(
      setTimeout(() => {
        const r = parseBridgeDocument(JSON.stringify(step.doc));
        if (!r.ok) return;
        const actions = ingest(t, r.msg, Date.now());
        for (const a of actions) {
          if (a.type === "trail") trail.push({ x: a.x, y: a.y, seg: a.seg });
          if (a.type === "journal") pushNotice(`[test data] Journal updated: ${a.questName ?? a.questId}`);
          if (a.type === "timeline") pushNotice(`[test data] ${a.summary}`);
        }
        setLive({ state: t.state, caps: t.caps, engine: "mwse", engineVersion: "replay", lastAt: Date.now() });
        setState({ replayTrail: [...trail] });
      }, step.at),
    );
  }
  replayTimers.push(setTimeout(stopReplay, steps[steps.length - 1].at + 4000));
}

export function stopReplay(): void {
  for (const t of replayTimers) clearTimeout(t);
  replayTimers = [];
  if (replaying) {
    replaying = false;
    setLive({ state: tracker.state, caps: tracker.caps, engine: tracker.engine, lastAt: tracker.lastMsgAt });
    setState({ replayTrail: null });
    refreshStatus();
  }
}

export function isReplaying(): boolean {
  return replaying;
}
