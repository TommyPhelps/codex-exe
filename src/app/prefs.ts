import { getState, setState, db } from "../state/store.ts";
import type { Prefs, BridgeConfig } from "../state/store.ts";
import { DEFAULT_PREFS } from "../state/store.ts";
import * as repo from "../db/repo.ts";

export async function loadPrefs(): Promise<Prefs> {
  const saved = await repo.getSetting<Partial<Prefs>>(db(), "prefs", {});
  return { ...DEFAULT_PREFS, ...saved, hotkeys: { ...DEFAULT_PREFS.hotkeys, ...(saved.hotkeys ?? {}) } };
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  const prefs = { ...getState().prefs, ...patch };
  setState({ prefs });
  await repo.saveSetting(db(), "prefs", prefs);
}

export function bridgeConfig(gameId: string): BridgeConfig {
  return getState().prefs.bridge[gameId] ?? { engine: "none", gameDir: "", cfgPath: "", logPath: "", bridgeDir: "" };
}

export async function saveBridgeConfig(gameId: string, cfg: BridgeConfig): Promise<void> {
  await savePrefs({ bridge: { ...getState().prefs.bridge, [gameId]: cfg } });
}
