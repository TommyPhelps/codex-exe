import { useEffect } from "react";
import { useApp, getState, setState } from "../state/store.ts";
import { migrate } from "../db/schema.ts";
import * as repo from "../db/repo.ts";
import * as native from "../platform/native.ts";
import { loadPrefs } from "./prefs.ts";
import { selectCharacter, setMode, loadAtlas } from "./actions.ts";
import { startLive } from "./live.ts";
import { applyThemeToDocument } from "../ui/theme.ts";
import { Shell } from "./Shell.tsx";
import { Welcome } from "./Welcome.tsx";
import type { ViewMode } from "../state/store.ts";
import { applyHotkeys } from "./hotkeys.ts";

async function boot(): Promise<void> {
  const driver = native.tauriDriver;
  setState({ db: driver });
  await migrate(driver);
  const prefs = await loadPrefs();
  const characters = (await repo.listCharacters(driver, true)).filter((c) => !c.archived);
  let activeId = await repo.getSetting<string | null>(driver, "activeCharacter", null);
  if (!characters.some((c) => c.id === activeId)) activeId = characters[0]?.id ?? null;
  const info = await native.appInfo().catch(() => null);
  let mode: ViewMode = "normal";
  try {
    const m = localStorage.getItem("codex.mode");
    if (m === "compact" || m === "map" || m === "journal") mode = m;
  } catch {
    /* storage unavailable */
  }
  setState({ prefs, characters, activeId, info, mode, ready: true });
  applyThemeToDocument(getState());
  const open = activeId ? await repo.openSession(driver, activeId) : null;
  setState({ sessionId: open?.id ?? null });
  const ch = characters.find((c) => c.id === activeId);
  if (ch) await loadAtlas(ch.gameId);
  if (native.isDesktop()) {
    if (prefs.alwaysOnTop) await native.setAlwaysOnTop(true).catch(() => {});
    await startLive().catch((e) => console.error(e));
    await applyHotkeys(prefs.hotkeys).catch(() => {});
    // One automatic database snapshot per day (kept in the data folder, newest 20).
    const last = await repo.getSetting<string | null>(driver, "lastAutoSnapshot", null);
    if (!last || Date.now() - Date.parse(last) > 20 * 3600 * 1000) {
      await native.snapshotDb("daily").then(() => repo.saveSetting(driver, "lastAutoSnapshot", new Date().toISOString())).catch(() => {});
    }
  }
}

export function App() {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const hasCharacters = useApp((s) => s.characters.length > 0);
  const activeId = useApp((s) => s.activeId);

  useEffect(() => {
    boot().catch((e) => setState({ bootError: e instanceof Error ? e.message : String(e) }));
  }, []);

  useEffect(() => {
    if (ready && hasCharacters && !activeId) void selectCharacter(getState().characters[0].id);
  }, [ready, hasCharacters, activeId]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setState({ paletteOpen: true });
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setMode(getState().mode === "compact" ? "normal" : "compact");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  if (bootError) {
    return (
      <div className="boot-error">
        <h1>CODEX.EXE could not start</h1>
        <p>{bootError}</p>
        <p>Your data has not been changed. If this keeps happening, restore a backup from the data folder.</p>
      </div>
    );
  }
  if (!ready) return <div className="boot">Opening the journal…</div>;
  if (!hasCharacters) return <Welcome />;
  return <Shell />;
}
