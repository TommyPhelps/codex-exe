import { getState, setState, db, bump, toast } from "../state/store.ts";
import type { ViewMode } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import * as native from "../platform/native.ts";
import { indexAtlas, parseHeights } from "../core/atlas.ts";
import type { AtlasData } from "../core/atlas.ts";
import { gameById } from "../core/games.ts";
import { applyThemeToDocument } from "../ui/theme.ts";

export async function refreshCharacters(): Promise<void> {
  const characters = (await repo.listCharacters(db(), true)).filter((c) => !c.archived);
  setState({ characters });
}

export async function selectCharacter(id: string | null): Promise<void> {
  const prev = getState().activeId;
  setState({ activeId: id, target: null });
  await repo.saveSetting(db(), "activeCharacter", id);
  if (id && id !== prev) {
    const open = await repo.openSession(db(), id);
    setState({ sessionId: open?.id ?? null });
  }
  applyThemeToDocument(getState());
  const ch = getState().characters.find((c) => c.id === id);
  if (ch) await loadAtlas(ch.gameId);
  // The bridge configuration may depend on the active game.
  const live = await import("./live.ts");
  await live.configureBridge();
  bump();
}

export async function createCharacter(gameId: string, name: string): Promise<string> {
  const id = await repo.createCharacter(db(), gameId, name);
  await repo.addEvent(db(), id, "app", `Started a ${gameById(gameId).short} journal`, "app");
  await refreshCharacters();
  await selectCharacter(id);
  toast(`Created ${name}.`, "ok");
  return id;
}

export async function loadAtlas(gameId: string): Promise<void> {
  if (gameById(gameId).map.provider !== "tes3-atlas" || !native.isDesktop()) {
    if (getState().atlas?.gameId !== gameId) setState({ atlas: null });
    return;
  }
  if (getState().atlas?.gameId === gameId) return;
  try {
    const files = await native.readAtlas(gameId);
    if (!files) {
      setState({ atlas: null });
      return;
    }
    const data = JSON.parse(files.json) as AtlasData;
    const buf = await native.readAtlasHeights(gameId);
    const ab = buf instanceof ArrayBuffer ? buf : new Uint8Array(buf as unknown as number[]).buffer;
    const { image } = parseHeights(ab);
    setState({ atlas: { gameId, index: indexAtlas(data), heights: image } });
  } catch (e) {
    setState({ atlas: null });
    toast(`The saved world map could not be loaded: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

export function setMode(mode: ViewMode): void {
  setState({ mode });
  applyThemeToDocument(getState());
  try {
    localStorage.setItem("codex.mode", mode);
  } catch {
    /* ignore */
  }
}

export function openQuick(seed = ""): void {
  setState({ quickOpen: true, quickSeed: seed });
}

export function closeQuick(): void {
  setState({ quickOpen: false, quickSeed: "" });
}
