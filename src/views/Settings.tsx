import { useEffect, useState } from "react";
import { useApp, useQuery, mutate, toast, db, getState, setState, bump, activeCharacter } from "../state/store.ts";
import type { BridgeConfig } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Field, Select, Toggle, Tabs, Pill, Source, Empty, Kbd } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { GAMES, SUPPORT_LABEL, gameById } from "../core/games.ts";
import { THEMES } from "../core/themes.ts";
import type { ThemeId } from "../core/games.ts";
import { useGame } from "../ui/theme.ts";
import { savePrefs, bridgeConfig, saveBridgeConfig } from "../app/prefs.ts";
import { createCharacter, refreshCharacters, selectCharacter, loadAtlas } from "../app/actions.ts";
import { configureBridge, startReplay, stopReplay, isReplaying, linkSyncName } from "../app/live.ts";
import { applyHotkeys } from "../app/hotkeys.ts";
import { normalizeHotkey, hotkeyConflicts, DEFAULT_HOTKEYS } from "../core/quick.ts";
import type { HotkeyConfig } from "../core/quick.ts";
import { exportBackup, checkBackup, restoreBackup, referencedFiles } from "../core/backup.ts";
import { buildAdventureMarkdown } from "../core/exportmd.ts";
import { relativeTime, formatDateTime, plural } from "../core/util.ts";
import * as native from "../platform/native.ts";
import { applyThemeToDocument } from "../ui/theme.ts";
import { defaultScreenshotDirs } from "../app/paths.ts";

type Tab = "profiles" | "bridge" | "mapdata" | "appearance" | "hotkeys" | "data" | "about";

function Profiles() {
  const { data: all } = useQuery((d) => repo.listCharacters(d, true), [], [] as repo.Character[]);
  const activeId = useApp((s) => s.activeId);
  const binding = useApp((s) => s.live.binding);
  const [gameId, setGameId] = useState(gameById(useApp((s) => activeCharacter(s)?.gameId ?? null)).id);
  const [name, setName] = useState("");
  return (
    <div className="grid-panels">
      <Panel title="New character" framed>
        <div className="row">
          <Select value={gameId} onChange={setGameId} options={GAMES.map((g) => ({ value: g.id, label: g.name }))} />
          <input className="field" placeholder="Character name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void createCharacter(gameId, name.trim()).then(() => setName(""))} />
          <Btn kind="primary" icon="plus" disabled={!name.trim()} onClick={() => void createCharacter(gameId, name.trim()).then(() => setName(""))}>Create</Btn>
        </div>
        <p className="muted small">{SUPPORT_LABEL[gameById(gameId).support]}. {gameById(gameId).supportNote}</p>
        <p className="muted small">Every character has its own journal, quests, people, map markers and sessions. Characters are never merged, even in the same game.</p>
      </Panel>
      {binding && binding.status !== "bound" ? (
        <Panel title="Where should live data go?" framed>
          <p>The game reports a character named <strong>{binding.syncName}</strong>. Pick the Morrowind character it belongs to:</p>
          <div className="row wrap">
            {all.filter((c) => c.gameId === "morrowind" && !c.archived).map((c) => (
              <Btn key={c.id} small onClick={() => void linkSyncName(c.id, binding.syncName)}>{c.name}</Btn>
            ))}
            <Btn small kind="primary" icon="plus" onClick={async () => {
              const id = await createCharacter("morrowind", binding.syncName);
              await linkSyncName(id, binding.syncName);
            }}>New character &ldquo;{binding.syncName}&rdquo;</Btn>
          </div>
        </Panel>
      ) : null}
      {GAMES.map((g) => {
        const list = all.filter((c) => c.gameId === g.id);
        if (!list.length) return null;
        return (
          <Panel key={g.id} title={<>{g.short} <Pill tone={g.support === "enhanced" ? "live" : "plain"}>{g.support === "enhanced" ? "bridge available" : "manual"}</Pill></>}>
            <ul className="list profile-list">
              {list.map((c) => (
                <li key={c.id} className={`profile ${c.archived ? "archived" : ""} ${c.id === activeId ? "on" : ""}`}>
                  <div className="row">
                    <Field value={c.name} onSave={(v) => void mutate((d) => repo.updateCharacter(d, c.id, { name: v })).then(refreshCharacters)} />
                    {c.id === activeId ? <Pill tone="accent">active</Pill> : !c.archived ? <Btn small onClick={() => void selectCharacter(c.id)}>Open</Btn> : null}
                    <Btn small kind="ghost" onClick={() => void mutate((d) => repo.updateCharacter(d, c.id, { archived: !c.archived })).then(async () => {
                      await refreshCharacters();
                      if (c.id === getState().activeId && !c.archived) await selectCharacter(getState().characters[0]?.id ?? null);
                    })}>{c.archived ? "Restore" : "Archive"}</Btn>
                    <ConfirmBtn confirmText="Delete this character and all its notes?" onConfirm={() => void mutate((d) => repo.deleteCharacter(d, c.id), "Character deleted.").then(async () => {
                      await refreshCharacters();
                      if (c.id === getState().activeId) await selectCharacter(getState().characters[0]?.id ?? null);
                    })} />
                  </div>
                  <div className="muted small">
                    Last played {relativeTime(c.lastPlayedAt)} · created {formatDateTime(c.createdAt)}
                  </div>
                  {g.bridges.length ? (
                    <div className="row small">
                      <span className="muted">In-game name for live data:</span>
                      <Field className="small" value={c.syncName ?? ""} placeholder="not linked" onSave={(v) => void mutate((d) => repo.updateCharacter(d, c.id, { syncName: v.trim() || null })).then(refreshCharacters)} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function BridgeStatusBox() {
  const status = useApp((s) => s.live.status);
  const caps = useApp((s) => s.live.caps);
  const engine = useApp((s) => s.live.engineVersion);
  const lastAt = useApp((s) => s.live.lastAt);
  const running = useApp((s) => s.live.running);
  const [replay, setReplay] = useState(isReplaying());
  return (
    <Panel title="Connection" framed>
      <div className={`status-big status-${status.state}`}>
        <span className="lamp" /> <strong>{status.label}</strong>
      </div>
      <p>{status.detail}</p>
      <ul className="kv">
        <li><span>Running games</span><span>{running.length ? running.join(", ") : "none detected"}</span></li>
        <li><span>Bridge</span><span>{engine ?? "\u2014"}</span></li>
        <li><span>Reports</span><span>{caps.length ? caps.join(", ") : "\u2014"}</span></li>
        <li><span>Last data</span><span>{lastAt ? relativeTime(new Date(lastAt).toISOString()) : "never"}</span></li>
      </ul>
      <div className="row">
        {!replay ? (
          <Btn small icon="play" onClick={() => { startReplay(); setReplay(true); }}>Replay test session</Btn>
        ) : (
          <Btn small icon="stop" onClick={() => { stopReplay(); setReplay(false); }}>Stop replay</Btn>
        )}
        <span className="muted small">Plays a synthetic session through the live display (map, status, notices). <Source kind="fixture" /> Nothing is saved.</span>
      </div>
    </Panel>
  );
}

function MwseSetup({ cfg, update }: { cfg: BridgeConfig; update: (c: Partial<BridgeConfig>) => void }) {
  const [st, setSt] = useState<native.MwseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => setSt(cfg.gameDir ? await native.mwseStatus(cfg.gameDir).catch(() => null) : null);
  useEffect(() => { void refresh(); }, [cfg.gameDir]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="row">
        <Field label="Morrowind folder" value={cfg.gameDir} placeholder="C:\\Program Files (x86)\\Steam\\steamapps\\common\\Morrowind" onSave={(v) => update({ gameDir: v.trim() })} />
        <Btn small icon="folder" onClick={async () => { const p = await native.pickFolder("Choose the Morrowind install folder").catch(() => null); if (p) update({ gameDir: p }); }}>Browse…</Btn>
      </div>
      {st ? (
        <ul className="checks">
          <li className={st.gameDirOk ? "ok" : "bad"}><Icon name={st.gameDirOk ? "check" : "close"} size={14} /> {st.gameDirOk ? "\u201cData Files\u201d found" : "No \u201cData Files\u201d folder here"}</li>
          <li className={st.mwseInstalled ? "ok" : "bad"}><Icon name={st.mwseInstalled ? "check" : "close"} size={14} /> {st.mwseInstalled ? "MWSE is installed" : "MWSE not found (needs Data Files\\MWSE). Install MWSE 2.1 first."}</li>
          <li className={st.bridgeInstalled ? (st.bridgeCurrent ? "ok" : "warn") : ""}><Icon name={st.bridgeInstalled ? "check" : "dot"} size={14} /> {st.bridgeInstalled ? (st.bridgeCurrent ? "CODEX bridge installed (current version)" : "An older CODEX bridge is installed \u2014 update it") : "CODEX bridge not installed"}</li>
        </ul>
      ) : null}
      <div className="row">
        <Btn kind="primary" small icon="check" disabled={busy || !st?.mwseInstalled} onClick={async () => {
          setBusy(true);
          try {
            const files = await native.installMwseBridge(cfg.gameDir);
            toast(`Bridge installed: ${files.join(", ")}`, "ok");
            await configureBridge();
          } catch (e) { toast(String(e), "error"); }
          setBusy(false);
          void refresh();
        }}>{st?.bridgeInstalled ? "Update bridge" : "Install bridge"}</Btn>
        {st?.bridgeInstalled ? (
          <ConfirmBtn icon="trash" confirmText="Remove the bridge files?" onConfirm={async () => {
            try {
              const removed = await native.uninstallMwseBridge(cfg.gameDir);
              toast(removed.length ? `Removed: ${removed.join(", ")}` : "Nothing to remove.", "ok");
            } catch (e) { toast(String(e), "error"); }
            void refresh();
          }}>Remove bridge</ConfirmBtn>
        ) : null}
      </div>
      <details className="explain">
        <summary>What gets installed?</summary>
        <p>One Lua file: <code>Data Files\MWSE\mods\codex\bridge\main.lua</code>. While you play it writes <code>Data Files\MWSE\codex_live.json</code> (your location, journal changes, character sheet). It never changes the game or your saves, stores nothing in them, and opens no network connections. Removing it deletes exactly those two files.</p>
      </details>
    </>
  );
}

function OpenMwSetup({ cfg, update }: { cfg: BridgeConfig; update: (c: Partial<BridgeConfig>) => void }) {
  const [st, setSt] = useState<[boolean, boolean, boolean] | null>(null);
  const [editCfg, setEditCfg] = useState(true);
  useEffect(() => {
    void (async () => {
      if (!cfg.cfgPath || !cfg.logPath || !cfg.bridgeDir) {
        const dirs = await native.userDirs().catch(() => null);
        if (dirs) update({ cfgPath: cfg.cfgPath || dirs.openmwCfg, logPath: cfg.logPath || dirs.openmwLog, bridgeDir: cfg.bridgeDir || `${dirs.openmwUser}\\CODEX bridge` });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => setSt(cfg.cfgPath && cfg.bridgeDir ? await native.openmwStatus(cfg.cfgPath, cfg.bridgeDir).catch(() => null) : null);
  useEffect(() => { void refresh(); }, [cfg.cfgPath, cfg.bridgeDir]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Field label="openmw.cfg" value={cfg.cfgPath} onSave={(v) => update({ cfgPath: v.trim() })} />
      <Field label="openmw.log" value={cfg.logPath} onSave={(v) => update({ logPath: v.trim() })} />
      <Field label="Bridge folder" value={cfg.bridgeDir} onSave={(v) => update({ bridgeDir: v.trim() })} />
      <Field label="OpenMW install folder (optional, for the map)" value={cfg.gameDir} onSave={(v) => update({ gameDir: v.trim() })} />
      {st ? (
        <ul className="checks">
          <li className={st[0] ? (st[1] ? "ok" : "warn") : ""}><Icon name={st[0] ? "check" : "dot"} size={14} /> {st[0] ? (st[1] ? "Bridge files present (current)" : "Bridge files present (older version)") : "Bridge files not installed"}</li>
          <li className={st[2] ? "ok" : ""}><Icon name={st[2] ? "check" : "dot"} size={14} /> {st[2] ? "Enabled in openmw.cfg" : "Not enabled in openmw.cfg"}</li>
        </ul>
      ) : null}
      <Toggle on={editCfg} onChange={setEditCfg} label="Add it to openmw.cfg for me (a backup, openmw.cfg.codex-backup, is saved first)" />
      <div className="row">
        <Btn kind="primary" small icon="check" onClick={async () => {
          try {
            const r = await native.installOpenmwBridge(cfg.bridgeDir, cfg.cfgPath, editCfg);
            toast(`Bridge installed${r.cfgUpdated ? " and enabled in openmw.cfg" : ""}.`, "ok");
            await configureBridge();
          } catch (e) { toast(String(e), "error"); }
          void refresh();
        }}>{st?.[0] ? "Update bridge" : "Install bridge"}</Btn>
        {st?.[0] || st?.[2] ? (
          <ConfirmBtn icon="trash" confirmText="Remove bridge files and openmw.cfg lines?" onConfirm={async () => {
            try {
              const removed = await native.uninstallOpenmwBridge(cfg.bridgeDir, cfg.cfgPath);
              toast(removed.length ? "Bridge removed." : "Nothing to remove.", "ok");
            } catch (e) { toast(String(e), "error"); }
            void refresh();
          }}>Remove bridge</ConfirmBtn>
        ) : null}
      </div>
      <details className="explain">
        <summary>How the OpenMW bridge works / manual setup</summary>
        <p>OpenMW&rsquo;s Lua scripts cannot write files, so the bridge prints one line per update into <code>openmw.log</code>, which CODEX.EXE reads. Requires OpenMW 0.49 or newer; journal text needs 0.50+. It defines no save handler, so nothing is stored in your saves.</p>
        <p>To enable it by hand, add these two lines to openmw.cfg (or add the folder and tick the content file in the OpenMW launcher):</p>
        <pre>{`data="${cfg.bridgeDir.replace(/\\/g, "/")}"\ncontent=codex_bridge.omwscripts`}</pre>
      </details>
    </>
  );
}

function BridgeTab() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const prefs = useApp((s) => s.prefs);
  const bridgeGame = game.bridges.length ? game : gameById("morrowind");
  const [cfg, setCfg] = useState<BridgeConfig>(bridgeConfig(bridgeGame.id));
  const [found, setFound] = useState<{ folder: string; path: string; source: string }[] | null>(null);
  const [shots, setShots] = useState<string>((prefs.screenshotDirs[ch.gameId] ?? []).join("\n"));
  const [defaults, setDefaults] = useState<string[]>([]);
  useEffect(() => { void defaultScreenshotDirs(ch.gameId).then(setDefaults); }, [ch.gameId, cfg.engine, cfg.gameDir]);
  const update = (patch: Partial<BridgeConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void saveBridgeConfig(bridgeGame.id, next).then(configureBridge);
  };
  return (
    <div className="grid-panels">
      <BridgeStatusBox />
      <Panel title={<>{bridgeGame.short} live bridge <Pill tone="live">optional</Pill></>} className="span-2">
        {!game.bridges.length ? <p className="muted">{game.short} has no live bridge: {game.supportNote} The settings below are for Morrowind.</p> : null}
        <div className="seg big" role="group" aria-label="Engine">
          {(["none", "mwse", "openmw"] as const).map((e) => (
            <button key={e} className={cfg.engine === e ? "on" : ""} onClick={() => update({ engine: e })}>
              {e === "none" ? "Manual (no bridge)" : e === "mwse" ? "Original engine + MWSE" : "OpenMW"}
            </button>
          ))}
        </div>
        {cfg.engine === "none" ? <p className="muted">Manual mode: every feature works; you record places, quests and stats yourself.</p> : null}
        {cfg.engine === "mwse" ? <MwseSetup cfg={cfg} update={update} /> : null}
        {cfg.engine === "openmw" ? <OpenMwSetup cfg={cfg} update={update} /> : null}
      </Panel>
      <Panel title="Find installed games">
        <Btn small icon="search" onClick={async () => setFound(await native.detectInstalls([...new Set(GAMES.flatMap((g) => g.installFolders))]).catch(() => []))}>Search Steam & common folders</Btn>
        {found ? (
          found.length ? (
            <ul className="list compact-list">
              {found.map((f) => {
                const g = GAMES.find((x) => x.installFolders.includes(f.folder));
                return (
                  <li key={f.path} className="list-row">
                    <span className="grow"><strong>{g?.short ?? f.folder}</strong> <span className="muted small">{f.path} ({f.source})</span></span>
                    {g?.id === "morrowind" && f.folder !== "OpenMW" ? <Btn small onClick={() => update({ gameDir: f.path, engine: cfg.engine === "none" ? "mwse" : cfg.engine })}>Use</Btn> : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted small">Nothing found in the usual places. Choose the folder by hand.</p>
        ) : <p className="muted small">Read-only: looks for game folders in your Steam libraries and common GOG/manual locations.</p>}
      </Panel>
      <Panel title={`${game.short}: running-game detection & screenshots`}>
        <p className="muted small">Detected executables: {game.executables.join(", ")}. CODEX checks the process list every few seconds and switches to the game&rsquo;s theme when it starts.</p>
        <Field label="Extra executable names" value={(prefs.extraExecutables[game.id] ?? []).join(", ")} placeholder="e.g. morrowind_mge.exe" onSave={(v) => void savePrefs({ extraExecutables: { ...prefs.extraExecutables, [game.id]: v.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.endsWith(".exe")) } }).then(configureBridge)} />
        <label className="field-label">Screenshot folders (one per line)</label>
        <textarea className="textblock" rows={3} value={shots} placeholder={defaults.join("\n") || game.screenshotHint} onChange={(e) => setShots(e.target.value)} onBlur={() => void savePrefs({ screenshotDirs: { ...prefs.screenshotDirs, [ch.gameId]: shots.split("\n").map((x) => x.trim()).filter(Boolean) } })} />
        <p className="muted small">{game.screenshotHint}{defaults.length && !shots.trim() ? ` Using: ${defaults.join("; ")}` : ""}</p>
      </Panel>
    </div>
  );
}

function MapDataTab() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const atlas = useApp((s) => (s.atlas && s.atlas.gameId === ch.gameId ? s.atlas : null));
  const cfg = bridgeConfig("morrowind");
  const [engine, setEngine] = useState<"mwse" | "openmw">(cfg.engine === "openmw" ? "openmw" : "mwse");
  const [dir, setDir] = useState(cfg.gameDir);
  const [order, setOrder] = useState<native.OrderItem[] | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (game.map.provider !== "tes3-atlas") {
    return (
      <Empty icon="map" title={`${game.short} uses imported maps`}>
        CODEX.EXE cannot read {game.short}&rsquo;s world data, so the map is an image you import (and annotate) on the Map page. Nothing is downloaded or bundled.
      </Empty>
    );
  }
  const discover = async () => {
    try {
      const dirs = await native.userDirs().catch(() => null);
      const items = await native.loadOrder(engine, dir, cfg.cfgPath || dirs?.openmwCfg || "", dirs?.openmwUser ?? "");
      setOrder(items);
      setSkip([]);
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const build = async () => {
    if (!order) return;
    const files = order.filter((o) => o.path && !skip.includes(o.name)).map((o) => o.path!);
    if (!files.length) return toast("No files selected.", "error");
    setBusy(true);
    try {
      await native.buildAtlas(ch.gameId, files);
      setState({ atlas: null });
      await loadAtlas(ch.gameId);
      toast("World map built from your game files.", "ok");
      bump();
    } catch (e) {
      toast(String(e), "error");
    }
    setBusy(false);
  };
  const data = atlas?.index.data;
  return (
    <div className="grid-panels">
      <Panel title={<>World map from your game files <Source kind="game" /></>} framed className="span-2">
        <p>
          CODEX.EXE builds Vvardenfell&rsquo;s relief map, place names, door links and travel services by reading the content files you own (Morrowind.esm and the plugins in your load order) &mdash; read-only. Nothing from the game is bundled with the app. Expansions and worldspace mods such as Tamriel Rebuilt are included automatically when they are in your load order.
        </p>
        <div className="seg" role="group">
          <button className={engine === "mwse" ? "on" : ""} onClick={() => setEngine("mwse")}>Original engine (Morrowind.ini)</button>
          <button className={engine === "openmw" ? "on" : ""} onClick={() => setEngine("openmw")}>OpenMW (openmw.cfg)</button>
        </div>
        <div className="row">
          <Field label={engine === "mwse" ? "Morrowind folder" : "OpenMW install folder (optional)"} value={dir} onSave={setDir} />
          <Btn small icon="folder" onClick={async () => { const p = await native.pickFolder("Choose the game folder").catch(() => null); if (p) setDir(p); }}>Browse…</Btn>
          <Btn small icon="search" onClick={() => void discover()} disabled={engine === "mwse" && !dir}>Read load order</Btn>
        </div>
        {order ? (
          <>
            <ul className="order-list">
              {order.map((o) => (
                <li key={o.name} className={o.path ? "" : "missing"}>
                  <label>
                    <input type="checkbox" disabled={!o.path} checked={!!o.path && !skip.includes(o.name)} onChange={(e) => setSkip(e.target.checked ? skip.filter((x) => x !== o.name) : [...skip, o.name])} />
                    {o.name}
                  </label>
                  <span className="muted small">{o.path ? `${(o.bytes / 1048576).toFixed(1)} MB` : "not found"}</span>
                </li>
              ))}
            </ul>
            <Btn kind="primary" icon="map" disabled={busy} onClick={() => void build()}>{busy ? "Reading files\u2026" : "Build world map"}</Btn>
          </>
        ) : null}
      </Panel>
      <Panel title="Current world map">
        {data ? (
          <>
            <ul className="kv">
              <li><span>Built</span><span>{formatDateTime(data.builtAt)}</span></li>
              <li><span>Files</span><span>{data.plugins.map((p) => p.name).join(", ")}</span></li>
              <li><span>Terrain cells</span><span>{data.stats.landCells}</span></li>
              <li><span>Named places</span><span>{atlas!.index.named.length}</span></li>
              <li><span>Interiors with a known way out</span><span>{Object.keys(data.exits).length} of {data.stats.interiors}</span></li>
              <li><span>Travel services</span><span>{plural(data.travel.length, "NPC")}</span></li>
              <li><span>Grid</span><span>x {data.grid.minX}…{data.grid.maxX}, y {data.grid.minY}…{data.grid.maxY} ({data.grid.spc} px per cell)</span></li>
            </ul>
            {data.warnings.length ? (
              <details className="explain"><summary>{plural(data.warnings.length, "warning")}</summary><ul>{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
            ) : null}
            <ConfirmBtn onConfirm={async () => { await native.deleteAtlas(ch.gameId).catch(() => {}); setState({ atlas: null }); bump(); }}>Delete world map</ConfirmBtn>
          </>
        ) : (
          <p className="muted">Not built yet. Until then the map shows a blank grid and all markers still work.</p>
        )}
      </Panel>
    </div>
  );
}

function AppearanceTab() {
  const prefs = useApp((s) => s.prefs);
  const game = useGame();
  const current = (prefs.themeOverride ?? game.theme) as ThemeId;
  const th = THEMES[current];
  const set = async (patch: Partial<typeof prefs>) => {
    await savePrefs(patch);
    applyThemeToDocument(getState());
  };
  return (
    <div className="grid-panels">
      <Panel title="Theme" framed className="span-2">
        <Toggle on={prefs.themeOverride === null} onChange={(v) => void set({ themeOverride: v ? null : current })} label={`Follow the game (recommended) \u2014 ${game.short} uses \u201c${THEMES[game.theme].name}\u201d`} />
        <div className="theme-cards">
          {Object.values(THEMES).map((t) => (
            <button key={t.id} className={`theme-card ${current === t.id ? "on" : ""}`} data-theme={t.id} data-variant={prefs.variants[t.id] ?? t.variants[0].id} onClick={() => void set({ themeOverride: t.id === game.theme ? null : t.id })}>
              <span className="tc-title">{t.name}</span>
              <span className="tc-sample">Quest log · Map · Notes</span>
              <span className="tc-swatches"><i /><i /><i /></span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={`Variant for ${th.name}`}>
        <div className="seg" role="group">
          {th.variants.map((v) => (
            <button key={v.id} className={(prefs.variants[th.id] ?? th.variants[0].id) === v.id ? "on" : ""} onClick={() => void set({ variants: { ...prefs.variants, [th.id]: v.id } })}>
              {v.label}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Readability">
        <Toggle on={prefs.decorations} onChange={(v) => void set({ decorations: v })} label="Decorative effects (textures, ornaments, scanlines, glows)" />
        <label className="field-row">
          <span className="field-label">Text size</span>
          <input type="range" min={0.85} max={1.4} step={0.05} value={prefs.fontScale} onChange={(e) => void set({ fontScale: Number(e.target.value) })} />
          <span className="muted">{Math.round(prefs.fontScale * 100)}%</span>
        </label>
      </Panel>
    </div>
  );
}

function HotkeysTab() {
  const prefs = useApp((s) => s.prefs);
  const [draft, setDraft] = useState<HotkeyConfig>(prefs.hotkeys);
  const [result, setResult] = useState<native.HotkeyResult[] | null>(null);
  const checks = (Object.keys(draft) as (keyof HotkeyConfig)[]).map((k) => ({ k, r: normalizeHotkey(draft[k]) }));
  const conflicts = hotkeyConflicts(draft);
  const labels: Record<keyof HotkeyConfig, string> = { quickNote: "Quick note (brings CODEX forward)", markHere: "Mark my position on the map (stays in the game)", toggleCompact: "Toggle compact mode" };
  return (
    <div className="grid-panels">
      <Panel title="Global hotkeys" framed className="span-2">
        <p className="muted small">These work while the game has focus. They must use Ctrl, Alt or Win so they never swallow game keys. Only the quick-note hotkey brings CODEX.EXE to the front &mdash; nothing else ever steals focus.</p>
        {checks.map(({ k, r }) => (
          <div key={k} className="field-row">
            <span className="field-label">{labels[k]}</span>
            <input className="field" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            {r.ok ? (r.warning ? <span className="warn small">{r.warning}</span> : <span className="ok-line small"><Icon name="check" size={12} /> {r.normalized}</span>) : <span className="warn small">{r.error}</span>}
          </div>
        ))}
        {conflicts.map((c) => <p key={c} className="warn small">{c}</p>)}
        <div className="row">
          <Btn kind="primary" small disabled={checks.some((c) => !c.r.ok) || conflicts.length > 0} onClick={async () => {
            const norm = Object.fromEntries(checks.map(({ k, r }) => [k, r.ok ? r.normalized : draft[k]])) as unknown as HotkeyConfig;
            setDraft(norm);
            await savePrefs({ hotkeys: norm });
            setResult(await applyHotkeys(norm).catch(() => null));
          }}>Save hotkeys</Btn>
          <Btn small kind="ghost" onClick={() => setDraft(DEFAULT_HOTKEYS)}>Defaults</Btn>
        </div>
        {result ? <ul className="checks">{result.map((r) => <li key={r.action} className={r.ok ? "ok" : "bad"}>{r.combo}: {r.ok ? "registered" : r.error}</li>)}</ul> : null}
        <p className="muted small">Inside the app: <Kbd>Ctrl</Kbd>+<Kbd>N</Kbd> quick note, <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> search, <Kbd>Ctrl</Kbd>+<Kbd>1</Kbd>…<Kbd>9</Kbd> sections, <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>M</Kbd> compact mode.</p>
      </Panel>
      <Panel title="Second-monitor window">
        <Toggle on={prefs.alwaysOnTop} onChange={(v) => { void savePrefs({ alwaysOnTop: v }); void native.setAlwaysOnTop(v).catch(() => {}); }} label="Always on top" />
        <p className="muted small">CODEX remembers its size, position and monitor between runs. Quick presets:</p>
        <div className="row wrap">
          <Btn small onClick={() => void native.setWindowSize(1920, 1040).catch(() => {})}>Full 1080p screen</Btn>
          <Btn small onClick={() => void native.setWindowSize(2560, 1400).catch(() => {})}>Full 1440p screen</Btn>
          <Btn small onClick={() => void native.setWindowSize(960, 1040).catch(() => {})}>Half of 1080p</Btn>
          <Btn small onClick={() => void native.setWindowSize(520, 900).catch(() => {})}>Narrow sidebar</Btn>
        </div>
      </Panel>
    </div>
  );
}

function DataTab() {
  const info = useApp((s) => s.info);
  const ch = useApp(activeCharacter)!;
  const [snaps, setSnaps] = useState<{ path: string; name: string; bytes: number; modifiedMs: number }[]>([]);
  const loadSnaps = async () => setSnaps(await native.listDbSnapshots().catch(() => []));
  useEffect(() => { void loadSnaps(); }, []);
  const reloadAll = async () => {
    const chars = (await repo.listCharacters(db(), true)).filter((c) => !c.archived);
    setState({ characters: chars });
    await selectCharacter(chars.some((c) => c.id === getState().activeId) ? getState().activeId : chars[0]?.id ?? null);
    bump();
  };
  return (
    <div className="grid-panels">
      <Panel title="Backups" framed className="span-2">
        <p className="muted small">Everything is stored locally in SQLite. A full copy of the database is saved automatically once a day (the newest 20 are kept).</p>
        <div className="row wrap">
          <Btn kind="primary" icon="export" onClick={async () => {
            const folder = await native.pickFolder("Choose where to save the backup").catch(() => null);
            if (!folder) return;
            try {
              const file = await exportBackup(db(), info?.version ?? "1.0.0");
              const dest = await native.writeBackupBundle(folder, JSON.stringify(file), referencedFiles(file));
              toast(`Backup saved to ${dest}`, "ok");
            } catch (e) { toast(String(e), "error"); }
          }}>Back up everything…</Btn>
          <Btn icon="refresh" onClick={async () => {
            const folder = await native.pickFolder("Choose a CODEX backup folder").catch(() => null);
            if (!folder) return;
            try {
              const json = await native.readBackupBundle(folder);
              const check = checkBackup(JSON.parse(json));
              if (!check.ok) return toast(check.error, "error");
              await native.snapshotDb("before-restore");
              await restoreBackup(db(), check.file);
              await reloadAll();
              toast(`Restored ${check.counts.characters} character(s). A safety copy of your previous data was saved first.`, "ok");
            } catch (e) { toast(String(e), "error"); }
          }}>Restore from a backup folder…</Btn>
          <Btn icon="folder" onClick={() => info && void native.revealPath(info.dbPath).catch(() => {})}>Show data folder</Btn>
        </div>
        <p className="muted small">Data folder: <code>{info?.dataDir}</code>{info?.portable ? " (portable mode)" : ""}</p>
      </Panel>
      <Panel title="Export">
        <Btn icon="book" onClick={async () => {
          const path = await native.pickSave("Export adventure journal", `${ch.name} - adventure journal.md`, [{ name: "Markdown", extensions: ["md"] }]).catch(() => null);
          if (!path) return;
          try {
            const { markdown, files } = await buildAdventureMarkdown(db(), ch.id);
            const n = await native.exportMarkdownFile(path, markdown, files);
            toast(`Exported${n ? ` with ${n} image(s)` : ""}.`, "ok");
          } catch (e) { toast(String(e), "error"); }
        }}>Export {ch.name}&rsquo;s journal as Markdown</Btn>
        <p className="muted small">Notes, diary, quests, people, places, dungeons and the timeline in one readable file. Screenshots are copied next to it.</p>
      </Panel>
      <Panel title="Automatic snapshots">
        <div className="row"><Btn small icon="plus" onClick={async () => { await native.snapshotDb("manual").catch((e) => toast(String(e), "error")); void loadSnaps(); }}>Snapshot now</Btn></div>
        {snaps.length === 0 ? <p className="muted small">None yet.</p> : (
          <ul className="list compact-list">
            {snaps.map((s) => (
              <li key={s.path} className="list-row">
                <span className="grow small">{s.name} <span className="muted">{(s.bytes / 1024).toFixed(0)} KB</span></span>
                <ConfirmBtn icon="refresh" confirmText="Replace current data with this snapshot?" onConfirm={async () => {
                  try {
                    await native.restoreDbSnapshot(s.path);
                    await reloadAll();
                    toast("Snapshot restored. Your previous data was saved as a snapshot first.", "ok");
                    void loadSnaps();
                  } catch (e) { toast(String(e), "error"); }
                }}>Restore</ConfirmBtn>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function AboutTab() {
  const info = useApp((s) => s.info);
  return (
    <div className="grid-panels">
      <Panel title={`CODEX.EXE ${info?.version ?? ""}`} framed className="span-2">
        <p>A local-first second-monitor companion for classic RPGs. No accounts, no cloud, no AI required.</p>
        <table className="support-table">
          <thead><tr><th>Game</th><th>Support</th><th>Live data</th><th>Map</th></tr></thead>
          <tbody>
            {GAMES.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{SUPPORT_LABEL[g.support]}</td>
                <td>{g.bridges.length ? "Optional bridge (MWSE-Lua / OpenMW)" : "None \u2014 manual"}</td>
                <td>{g.map.provider === "tes3-atlas" ? "Built from your game files" : "Your imported image or sketch"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Honest limits">
        <ul className="small">
          <li>The Morrowind bridges were tested against mocks of the documented MWSE and OpenMW APIs and a synthetic replay — not against a running copy of the game during development.</li>
          <li>Other games are manual companions: CODEX only detects that their executable is running.</li>
          <li>CODEX never knows dungeon layouts, container contents, prices or quest solutions unless you write them down.</li>
          <li>Hints show only your own notes and the game&rsquo;s own journal text; walkthroughs open in your browser only when you ask.</li>
        </ul>
      </Panel>
      <Panel title="Credits">
        <p className="small">Fonts are open-licensed (SIL OFL): IM Fell English, Crimson Pro, Caveat, MedievalSharp, Pirata One, Alegreya, Cinzel, Spectral, Marcellus SC, Josefin Sans, VT323, Share Tech Mono, Orbitron, Exo 2, Grenze Gotisch, Oswald, Roboto Condensed. All artwork and ornaments are original. Game names are used only to identify which game a theme is for; CODEX.EXE is not affiliated with any publisher.</p>
      </Panel>
    </div>
  );
}

export function SettingsView() {
  const target = useApp((s) => s.target);
  const [tab, setTab] = useState<Tab>((target?.extra as Tab) ?? "profiles");
  useEffect(() => {
    if (target?.extra) setTab(target.extra as Tab);
  }, [target]);
  return (
    <Page title="Settings">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "profiles", label: "Characters" },
          { id: "bridge", label: "Game & bridge" },
          { id: "mapdata", label: "World map data" },
          { id: "appearance", label: "Appearance" },
          { id: "hotkeys", label: "Hotkeys & window" },
          { id: "data", label: "Data & backups" },
          { id: "about", label: "About" },
        ]}
      />
      {tab === "profiles" ? <Profiles /> : tab === "bridge" ? <BridgeTab /> : tab === "mapdata" ? <MapDataTab /> : tab === "appearance" ? <AppearanceTab /> : tab === "hotkeys" ? <HotkeysTab /> : tab === "data" ? <DataTab /> : <AboutTab />}
    </Page>
  );
}
