/**
 * Global UI state: a tiny external store read with useSyncExternalStore.
 * Database rows are not kept here - views query SQLite and re-query when
 * `rev` changes.
 */
import { useSyncExternalStore, useEffect, useState, useCallback, useRef } from "react";
import type { SqlDriver } from "../db/driver.ts";
import type { Character } from "../db/repo.ts";
import type { SectionId } from "../core/themes.ts";
import type { ConnStatus } from "../core/live.ts";
import type { Cap, Engine, LiveState } from "../core/protocol.ts";
import type { SyncBinding } from "../core/sync.ts";
import type { AppInfo } from "../platform/native.ts";
import type { HotkeyConfig } from "../core/quick.ts";
import { DEFAULT_HOTKEYS } from "../core/quick.ts";
import type { AtlasIndex, HeightImage } from "../core/atlas.ts";

export type ViewMode = "normal" | "compact" | "map" | "journal";

export interface BridgeConfig {
  engine: Engine | "none";
  /** Morrowind install folder (original engine) or OpenMW install folder. */
  gameDir: string;
  /** OpenMW: user openmw.cfg and log paths; bridge data folder. */
  cfgPath: string;
  logPath: string;
  bridgeDir: string;
}

export interface Prefs {
  themeOverride: string | null;
  variants: Record<string, string>;
  decorations: boolean;
  fontScale: number;
  alwaysOnTop: boolean;
  hotkeys: HotkeyConfig;
  bridge: Record<string, BridgeConfig>;
  screenshotDirs: Record<string, string[]>;
  extraExecutables: Record<string, string[]>;
  referenceMode: boolean;
  fogOfWar: boolean;
  showTrail: boolean;
  followPlayer: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  themeOverride: null,
  variants: {},
  decorations: true,
  fontScale: 1,
  alwaysOnTop: false,
  hotkeys: DEFAULT_HOTKEYS,
  bridge: {},
  screenshotDirs: {},
  extraExecutables: {},
  referenceMode: false,
  fogOfWar: false,
  showTrail: true,
  followPlayer: true,
};

export interface LiveView {
  status: ConnStatus;
  state: LiveState | null;
  engine: Engine | null;
  engineVersion: string | null;
  caps: Cap[];
  lastAt: number | null;
  binding: SyncBinding | null;
  running: string[];
  notices: { id: number; text: string; at: number }[];
  reminders: string[];
}

export interface NavTarget {
  section: SectionId;
  type?: string;
  id?: string;
  /** Extra info, e.g. a map id for a marker, or a tab. */
  extra?: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
}

export interface AtlasState {
  gameId: string;
  index: AtlasIndex;
  heights: HeightImage;
}

export interface AppState {
  ready: boolean;
  bootError: string | null;
  db: SqlDriver | null;
  info: AppInfo | null;
  characters: Character[];
  activeId: string | null;
  section: SectionId;
  target: NavTarget | null;
  rev: number;
  mode: ViewMode;
  prefs: Prefs;
  live: LiveView;
  toasts: Toast[];
  quickOpen: boolean;
  quickSeed: string;
  paletteOpen: boolean;
  atlas: AtlasState | null;
  sessionId: string | null;
  /** In-memory trail while the synthetic replay runs (never saved). */
  replayTrail: { x: number; y: number; seg: number }[] | null;
}

let state: AppState = {
  ready: false,
  bootError: null,
  db: null,
  info: null,
  characters: [],
  activeId: null,
  section: "resume",
  target: null,
  rev: 0,
  mode: "normal",
  prefs: DEFAULT_PREFS,
  live: {
    status: { state: "manual", label: "Manual mode", detail: "" },
    state: null,
    engine: null,
    engineVersion: null,
    caps: [],
    lastAt: null,
    binding: null,
    running: [],
    notices: [],
    reminders: [],
  },
  toasts: [],
  quickOpen: false,
  quickSeed: "",
  paletteOpen: false,
  atlas: null,
  sessionId: null,
  replayTrail: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

export function setLive(patch: Partial<LiveView>): void {
  setState((s) => ({ live: { ...s.live, ...patch } }));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

export function db(): SqlDriver {
  if (!state.db) throw new Error("Database not ready");
  return state.db;
}

/** Signals that data changed so views re-query. */
export function bump(): void {
  setState((s) => ({ rev: s.rev + 1 }));
}

let toastId = 0;
export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 3500);
}

export function navigate(target: NavTarget): void {
  setState({ section: target.section, target, paletteOpen: false });
}

export function activeCharacter(s: AppState = state): Character | null {
  return s.characters.find((c) => c.id === s.activeId) ?? null;
}

/**
 * Runs an async query against the database and re-runs it when data changes
 * (`rev`) or when deps change. Errors are surfaced, never swallowed.
 */
export function useQuery<T>(fn: (db: SqlDriver) => Promise<T>, deps: unknown[], initial: T): { data: T; loading: boolean; error: string | null; reload: () => void } {
  const rev = useApp((s) => s.rev);
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const d = state.db;
    if (!d) return;
    setLoading(true);
    fnRef
      .current(d)
      .then((v) => {
        if (alive) {
          setData(v);
          setError(null);
        }
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, nonce, ...deps]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Wraps a mutation: runs it, bumps rev, and shows errors as toasts. */
export async function mutate<T>(fn: (db: SqlDriver) => Promise<T>, okMessage?: string): Promise<T | undefined> {
  try {
    const r = await fn(db());
    bump();
    if (okMessage) toast(okMessage, "ok");
    return r;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  }
}
