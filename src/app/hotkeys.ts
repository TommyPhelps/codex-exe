import * as native from "../platform/native.ts";
import type { HotkeyConfig } from "../core/quick.ts";
import { getState, toast, setState } from "../state/store.ts";
import { openQuick, setMode } from "./actions.ts";
import * as repo from "../db/repo.ts";
import { WORLD_MAP } from "../db/repo.ts";
import { cellLabel } from "../core/protocol.ts";
import { mutate } from "../state/store.ts";

let unlisten: (() => void) | null = null;

export async function applyHotkeys(cfg: HotkeyConfig): Promise<native.HotkeyResult[]> {
  if (!native.isDesktop()) return [];
  if (!unlisten) unlisten = await native.listen<string>("hotkey", (action) => void onHotkey(action));
  const results = await native.setHotkeys([
    { action: "quickNote", combo: cfg.quickNote },
    { action: "markHere", combo: cfg.markHere },
    { action: "toggleCompact", combo: cfg.toggleCompact },
  ]);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) toast(`Some hotkeys could not be registered (${failed.map((f) => f.combo).join(", ")}). Another program may be using them.`, "error");
  return results;
}

async function onHotkey(action: string): Promise<void> {
  const s = getState();
  if (action === "quickNote") {
    openQuick();
    return;
  }
  if (action === "toggleCompact") {
    setMode(s.mode === "compact" ? "normal" : "compact");
    return;
  }
  if (action === "markHere") {
    // Adds a marker at the live position without taking focus from the game.
    const st = s.live.state;
    const ch = s.characters.find((c) => c.id === s.activeId);
    if (!ch) return;
    if (!st?.cell || !st.pos || !st.cell.exterior) {
      toast(st?.cell && !st.cell.exterior ? `Inside ${cellLabel(st.cell)} — no world-map position. Use a dungeon note instead.` : "No live position from the game right now.", "error");
      return;
    }
    const label = `Marked at ${cellLabel(st.cell)}`;
    await mutate((d) => repo.addMarker(d, ch.id, { mapId: WORLD_MAP, x: st.pos!.x, y: st.pos!.y, category: "revisit", label, note: "Placed with the mark-here hotkey." }));
    setState((p) => ({ live: { ...p.live, notices: [...p.live.notices, { id: Date.now(), text: `Marker placed: ${label}`, at: Date.now() }] } }));
  }
}
