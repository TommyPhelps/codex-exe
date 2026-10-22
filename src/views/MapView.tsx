import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useQuery, mutate, navigate, toast, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Marker, MapRec } from "../db/repo.ts";
import { WORLD_MAP } from "../db/repo.ts";
import { Page, Btn, ConfirmBtn, Field, TextBlock, Select, Toggle, Empty, Pill, Source } from "../ui/bits.tsx";
import { Icon, MARKER_ICON } from "../ui/icons.tsx";
import { Compass } from "../ui/ornaments.tsx";
import { LinkChips } from "../ui/links.tsx";
import { useTerm, useGame, useMapStyle } from "../ui/theme.ts";
import { markerCategory } from "../core/games.ts";
import type { AtlasGrid, Pt, CalibPoint, Calibration } from "../core/mapmath.ts";
import { atlasWorldToPx, atlasPxToWorld, atlasSize, applyAffine, invertAffine, fitCalibration, cellOfWorld, cellCenter } from "../core/mapmath.ts";
import { placeLabels, exitFor, gameTravelEdges } from "../core/atlas.ts";
import { cellLabel } from "../core/protocol.ts";
import { parseJson, normKey } from "../core/util.ts";
import { reliefCanvas, gridCanvas, fogCanvas } from "./map/base.ts";
import { MapCanvas } from "./map/MapCanvas.tsx";
import type { SketchItem, SketchTool, MapLabel, MapLine, MapPoint } from "./map/MapCanvas.tsx";
import * as native from "../platform/native.ts";
import { savePrefs } from "../app/prefs.ts";

const SWATCHES = ["#b5832a", "#8f2e22", "#3f6b3a", "#365a7a", "#7a3d6b", "#2e6b6b", "#555049", "#d8c27a"];

/** Grid used before an atlas exists: covers markers and trail, at least around the origin. */
function blankGrid(points: Pt[], cellSize: number): AtlasGrid {
  let minX = -20, maxX = 25, minY = -20, maxY = 25;
  for (const q of points) {
    const c = cellOfWorld(cellSize, q);
    minX = Math.min(minX, c.gx - 3);
    maxX = Math.max(maxX, c.gx + 3);
    minY = Math.min(minY, c.gy - 3);
    maxY = Math.max(maxY, c.gy + 3);
  }
  return { minX, maxX, minY, maxY, spc: 24, cellSize };
}

function useImageSize(url: string | null): { w: number; h: number } | null {
  const [s, setS] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) return setS(null);
    const img = new Image();
    img.onload = () => setS({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);
  return s;
}

function MarkerEditor({ marker, onClose, onMove, worldInfo }: { marker: Marker; onClose: () => void; onMove: () => void; worldInfo: string | null }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  return (
    <div className="map-ui marker-editor panel">
      <div className="me-head">
        <span className="me-icon" style={{ color: marker.color ?? markerCategory(game, marker.category).color }}>
          <Icon name={MARKER_ICON[marker.category] ?? "dot"} size={18} />
        </span>
        <Field className="me-title" value={marker.label} placeholder="Name this place" onSave={(v) => void mutate((d) => repo.updateMarker(d, marker.id, { label: v }))} autoFocus={!marker.label} />
        <Btn small kind="ghost" icon="close" title="Close" onClick={onClose} />
      </div>
      <div className="row">
        <Select value={marker.category} onChange={(v) => void mutate((d) => repo.updateMarker(d, marker.id, { category: v }))} options={game.markerCategories.map((c) => ({ value: c.id, label: c.label }))} />
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} className={`swatch ${marker.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => void mutate((d) => repo.updateMarker(d, marker.id, { color: marker.color === c ? null : c }))} title="Colour" />
          ))}
        </div>
      </div>
      {worldInfo ? <div className="muted small">{worldInfo}</div> : null}
      <TextBlock value={marker.note} rows={3} placeholder="Notes about this place" onSave={(v) => void mutate((d) => repo.updateMarker(d, marker.id, { note: v }))} />
      <LinkChips characterId={ch.id} self={{ type: "marker", id: marker.id }} addTypes={["quest", "npc", "delve", "note"]} createNpc />
      <div className="row">
        <Toggle on={marker.done} onChange={(v) => void mutate((d) => repo.updateMarker(d, marker.id, { done: v }))} label="Done / visited" />
        <span className="grow" />
        <Btn small icon="target" onClick={onMove}>Move</Btn>
        <ConfirmBtn onConfirm={() => { void mutate((d) => repo.deleteMarker(d, marker.id)); onClose(); }} />
      </div>
    </div>
  );
}

function Calibrator({ map, imgW, imgH, onDone, picked, setPicked }: { map: MapRec; imgW: number; imgH: number; onDone: () => void; picked: CalibPoint[]; setPicked: (p: CalibPoint[]) => void }) {
  const result = picked.length >= 2 ? fitCalibration(picked) : null;
  return (
    <div className="map-ui calibrator panel">
      <h3>Calibrate this map</h3>
      <p className="small">
        Click a spot on the image whose game position you know, then type its world coordinates (or a cell, e.g. <code>-3,-2</code>, for that cell&rsquo;s centre). Two points give scale and rotation; three or more correct a stretched scan. Without calibration your markers still work &mdash; only the live position is hidden.
      </p>
      <ol className="calib-list">
        {picked.map((c, i) => (
          <li key={i} className="row">
            <span>#{i + 1} at pixel {Math.round(c.px)}, {Math.round(c.py)}</span>
            <input
              className="field small"
              placeholder="x, y or cell gx,gy"
              defaultValue={Number.isFinite(c.wx) ? `${c.wx}, ${c.wy}` : ""}
              onBlur={(e) => {
                const nums = e.target.value.split(/[ ,;]+/).map(Number).filter((n) => Number.isFinite(n));
                if (nums.length < 2) return;
                const isCell = Math.abs(nums[0]) < 200 && Math.abs(nums[1]) < 200;
                const w = isCell ? cellCenter(8192, nums[0], nums[1]) : { x: nums[0], y: nums[1] };
                setPicked(picked.map((q, j) => (j === i ? { ...q, wx: w.x, wy: w.y } : q)));
              }}
            />
            <Btn small kind="ghost" icon="close" onClick={() => setPicked(picked.filter((_, j) => j !== i))} title="Remove point" />
          </li>
        ))}
      </ol>
      {picked.length === 0 ? <p className="muted small">Click the map to place point #1.</p> : null}
      {result ? (
        result.ok ? (
          <p className={result.calibration.rmsPx > Math.max(imgW, imgH) * 0.01 ? "warn small" : "ok-line small"}>
            Fit error: {result.calibration.rmsPx.toFixed(1)} px{result.calibration.rmsPx > Math.max(imgW, imgH) * 0.01 ? " — check your points; positions may be off." : " — good."}
          </p>
        ) : (
          <p className="warn small">{result.error}</p>
        )
      ) : null}
      <div className="row">
        <Btn
          kind="primary"
          small
          disabled={!result?.ok}
          onClick={async () => {
            if (!result?.ok) return;
            await mutate((d) => repo.updateMap(d, map.id, { calib: JSON.stringify(result.calibration) }), "Map calibrated.");
            onDone();
          }}
        >
          Save calibration
        </Btn>
        {map.calib ? (
          <Btn small kind="danger" onClick={async () => { await mutate((d) => repo.updateMap(d, map.id, { calib: null }), "Calibration removed."); onDone(); }}>
            Remove calibration
          </Btn>
        ) : null}
        <Btn small kind="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}

export function MapView() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const t = useTerm();
  const style = useMapStyle();
  const atlas = useApp((s) => (s.atlas && s.atlas.gameId === ch.gameId ? s.atlas : null));
  const liveState = useApp((s) => s.live.state);
  const liveFresh = useApp((s) => ["live", "limited"].includes(s.live.status.state));
  const replayTrail = useApp((s) => s.replayTrail);
  const prefs = useApp((s) => s.prefs);
  const target = useApp((s) => s.target);
  const cellSize = game.map.cellSize ?? 8192;
  const worldCapable = game.map.provider === "tes3-atlas";
  const storageKey = `codex.map.${ch.id}`;

  const { data: maps } = useQuery((d) => repo.listMaps(d, ch.id), [ch.id], [] as MapRec[]);
  const [mapId, setMapIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? (worldCapable ? WORLD_MAP : "");
    } catch {
      return worldCapable ? WORLD_MAP : "";
    }
  });
  const setMapId = (id: string) => {
    setMapIdState(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* ignore */
    }
  };
  const currentMap = maps.find((m) => m.id === mapId) ?? null;
  const isWorld = worldCapable && (mapId === WORLD_MAP || !currentMap);
  useEffect(() => {
    if (!worldCapable && !currentMap && maps.length) setMapId(maps[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, mapId, worldCapable]);
  const effectiveMapId = isWorld ? WORLD_MAP : currentMap?.id ?? "";

  const { data: markers } = useQuery((d) => (effectiveMapId ? repo.listMarkers(d, ch.id, effectiveMapId) : Promise.resolve([])), [ch.id, effectiveMapId], [] as Marker[]);
  const { data: trail } = useQuery((d) => (isWorld ? repo.listTrail(d, ch.id) : Promise.resolve([])), [ch.id, isWorld], [] as repo.TrailPoint[]);
  const { data: visits } = useQuery((d) => repo.listVisits(d, ch.id), [ch.id], [] as repo.Visit[]);

  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(prefs.followPlayer);
  const [focus, setFocus] = useState<{ pt: Pt; key: string } | null>(null);
  const [adding, setAdding] = useState<{ px: Pt; screen: Pt; label: string; category: string } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [filterCats, setFilterCats] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [layersOpen, setLayersOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibPicked, setCalibPicked] = useState<CalibPoint[]>([]);
  const [tool, setTool] = useState<SketchTool>("hand");
  const [textAt, setTextAt] = useState<{ px: Pt; screen: Pt } | null>(null);
  const [showList, setShowList] = useState(true);
  const [showTravel, setShowTravel] = useState(false);
  const [showInterventions, setShowInterventions] = useState(false);
  const pendingLabel = useRef<string>("");

  // ---- geometry for the current map
  const grid: AtlasGrid | null = isWorld
    ? atlas
      ? atlas.index.data.grid
      : blankGrid([...markers.map((m) => ({ x: m.x, y: m.y })), ...trail.slice(-500)], cellSize)
    : null;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    setImageUrl(null);
    if (currentMap?.kind === "image" && currentMap.image) {
      native.dataImageUrl(currentMap.image).then(setImageUrl).catch(() => setImageUrl(null));
    }
  }, [currentMap?.id, currentMap?.image, currentMap?.kind]);
  const imgSize = useImageSize(imageUrl);
  const calibration = currentMap?.calib ? parseJson<Calibration | null>(currentMap.calib, null) : null;

  const dims = grid ? atlasSize(grid) : currentMap?.kind === "sketch" ? { width: 2400, height: 1600 } : imgSize ? { width: imgSize.w, height: imgSize.h } : { width: 2048, height: 2048 };
  const toPx = useMemo<((w: Pt) => Pt) | undefined>(() => {
    if (grid) return (w: Pt) => atlasWorldToPx(grid, w);
    if (calibration) return (w: Pt) => applyAffine(calibration.transform, w);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid?.minX, grid?.maxX, grid?.minY, grid?.maxY, grid?.spc, calibration?.rmsPx, currentMap?.calib]);
  const fromPx = useMemo<((p: Pt) => Pt) | undefined>(() => {
    if (grid) return (p: Pt) => atlasPxToWorld(grid, p);
    if (calibration) {
      const inv = invertAffine(calibration.transform);
      return inv ? (p: Pt) => applyAffine(inv, p) : undefined;
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid?.minX, grid?.maxX, grid?.minY, grid?.maxY, grid?.spc, currentMap?.calib]);
  // Markers on world-capable maps are stored in world units; elsewhere in image pixels.
  const markersInWorld = isWorld || (!!calibration && worldCapable);

  const base = useMemo(() => {
    if (isWorld && atlas && grid) return reliefCanvas(`${ch.gameId}|${atlas.index.data.builtAt}`, atlas.heights, style);
    if (isWorld && grid) return gridCanvas(grid, style);
    if (currentMap?.kind === "image") return imageUrl;
    if (currentMap?.kind === "sketch" || !currentMap) {
      const g: AtlasGrid = { minX: 0, maxX: 99, minY: 0, maxY: 65, spc: 24, cellSize: 1 };
      return gridCanvas(g, style);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorld, atlas, grid?.minX, grid?.maxX, grid?.minY, grid?.maxY, style, currentMap?.kind, imageUrl]);

  const exteriorVisits = useMemo(() => visits.filter((v) => !v.interior && v.gx !== null && v.gy !== null).map((v) => ({ gx: v.gx!, gy: v.gy! })), [visits]);
  const fog = useMemo(() => (isWorld && grid && prefs.fogOfWar ? fogCanvas(grid, exteriorVisits, style) : null), [isWorld, grid?.minX, grid?.maxY, grid?.spc, prefs.fogOfWar, exteriorVisits, style]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- labels & reference layers (only from the player's own game files)
  const labels: MapLabel[] = useMemo(() => {
    if (!isWorld || !atlas) return [];
    const visited = new Set(visits.map((v) => normKey(v.name.split(",")[0])));
    const all = placeLabels(atlas.index);
    return all
      .filter((l) => prefs.referenceMode || visited.has(normKey(l.name)))
      .map((l) => ({ name: l.name, x: l.x, y: l.y, weight: l.cells >= 3 ? 3 : l.cells }));
  }, [isWorld, atlas, visits, prefs.referenceMode]);
  const lines: MapLine[] = useMemo(() => {
    if (!isWorld || !atlas || !showTravel || !prefs.referenceMode) return [];
    return atlas.index.data.travel.flatMap((n) => n.interior ? [] : n.dest.filter(() => true).map((d) => ({ x1: n.x, y1: n.y, x2: d.x, y2: d.y, title: `${n.npc} (${n.className}): ${n.cell} → ${d.cell}` })));
  }, [isWorld, atlas, showTravel, prefs.referenceMode]);
  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
    if (isWorld && atlas && showInterventions && prefs.referenceMode) {
      for (const m of atlas.index.data.markers) out.push({ x: m.x, y: m.y, kind: m.kind, label: m.kind === "divine" ? "Divine Intervention marker (game files)" : "Almsivi Intervention marker (game files)" });
    }
    return out;
  }, [isWorld, atlas, showInterventions, prefs.referenceMode]);

  // ---- live player position (never inside interiors)
  const liveCell = liveFresh ? liveState?.cell : undefined;
  const player = isWorld && liveCell?.exterior && liveState?.pos ? { x: liveState.pos.x, y: liveState.pos.y, yaw: liveState.pos.yaw } : !isWorld && calibration && worldCapable && liveCell?.exterior && liveState?.pos ? { x: liveState.pos.x, y: liveState.pos.y, yaw: liveState.pos.yaw } : null;
  const interiorExit = isWorld && liveCell && !liveCell.exterior ? exitFor(atlas?.index.data ?? null, liveCell.name) : null;
  if (interiorExit) points.push({ x: interiorExit.x, y: interiorExit.y, kind: "exit", label: `Way out of ${liveCell?.name} (from your game files, via ${interiorExit.via})` });

  // ---- navigation targets
  useEffect(() => {
    if (!target || target.section !== "map") return;
    if (target.type === "marker" && target.id) {
      if (target.extra && target.extra !== effectiveMapId) setMapId(target.extra === WORLD_MAP ? WORLD_MAP : target.extra);
      setSelected(target.id);
    } else if (target.type === "newMarker") {
      pendingLabel.current = target.extra ?? "";
    } else if (target.type === "visit" && target.id && grid) {
      const m = /^ext:(-?\d+),(-?\d+)$/.exec(target.id);
      if (m) setFocus({ pt: atlasWorldToPx(grid, cellCenter(cellSize, Number(m[1]), Number(m[2]))), key: target.id + Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const selMarker = markers.find((m) => m.id === selected) ?? null;
  useEffect(() => {
    if (selMarker) {
      const pt = markersInWorld && toPx ? toPx({ x: selMarker.x, y: selMarker.y }) : { x: selMarker.x, y: selMarker.y };
      setFocus({ pt, key: selMarker.id });
      setFollow(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const shownMarkers = markers.filter((m) => (!filterCats.length || filterCats.includes(m.category)) && (!query.trim() || `${m.label} ${m.note}`.toLowerCase().includes(query.trim().toLowerCase())));
  const markerToPx = markersInWorld ? toPx : undefined;

  const createMarker = async (px: Pt, label: string, category: string) => {
    const pos = markersInWorld && fromPx ? fromPx(px) : px;
    const id = await mutate((d) => repo.addMarker(d, ch.id, { mapId: effectiveMapId, x: pos.x, y: pos.y, label, category }));
    if (id) setSelected(id);
  };

  const sketchItems: SketchItem[] = currentMap?.kind === "sketch" ? parseJson<{ items: SketchItem[] }>(currentMap.sketch, { items: [] }).items : [];
  const saveSketch = (items: SketchItem[]) => currentMap && void mutate((d) => repo.updateMap(d, currentMap.id, { sketch: JSON.stringify({ items }) }));

  // Place search: my markers, visited places, and (reference mode) named cells from the game files.
  const searchHits = useMemo(() => {
    const q = normKey(query);
    if (q.length < 2 || !isWorld) return [];
    const hits: { label: string; pt: Pt; kind: string }[] = [];
    for (const m of markers) if (normKey(m.label).includes(q)) hits.push({ label: m.label, pt: { x: m.x, y: m.y }, kind: "marker" });
    if (atlas) {
      const visited = new Set(visits.map((v) => normKey(v.name.split(",")[0])));
      for (const l of placeLabels(atlas.index)) {
        if (normKey(l.name).includes(q) && (prefs.referenceMode || visited.has(normKey(l.name)))) hits.push({ label: l.name, pt: { x: l.x, y: l.y }, kind: "place" });
      }
    }
    return hits.slice(0, 8);
  }, [query, markers, atlas, visits, prefs.referenceMode, isWorld]);

  const importImage = async () => {
    const p = await native.pickFile("Import a map image", [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "webp"] }]).catch(() => null);
    if (!p) return;
    const rel = await native.importMapImage(p).catch((e: unknown) => {
      toast(String(e), "error");
      return null;
    });
    if (!rel) return;
    const name = p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Imported map";
    const id = await mutate((d) => repo.createMap(d, ch.id, ch.gameId, "image", name, rel), "Map imported.");
    if (id) setMapId(id);
  };
  const newSketch = async () => {
    const id = await mutate((d) => repo.createMap(d, ch.id, ch.gameId, "sketch", "New sketch"));
    if (id) setMapId(id);
  };

  const mapOptions = [
    ...(worldCapable ? [{ value: WORLD_MAP, label: `${game.map.worldName} (world)` }] : []),
    ...maps.map((m) => ({ value: m.id, label: `${m.name}${m.kind === "sketch" ? " (sketch)" : ""}` })),
  ];
  const noMapYet = !isWorld && !currentMap;
  const worldInfo = selMarker && markersInWorld ? (() => {
    const c = cellOfWorld(cellSize, selMarker);
    const named = atlas?.index.byGrid.get(`${c.gx},${c.gy}`);
    return `Cell ${c.gx}, ${c.gy}${named?.name ? ` · ${named.name}` : named?.region ? ` · ${named.region}` : ""}`;
  })() : null;

  return (
    <Page
      title={t("map")}
      className="map-page"
      subtitle={
        isWorld ? (
          atlas ? (
            <span>
              Relief from your installed game files <Source kind="game" />
            </span>
          ) : (
            <span>No world map built yet — a blank grid is shown. Build one from your game files in Settings, or import an image.</span>
          )
        ) : currentMap?.kind === "image" ? (
          calibration ? <span>Imported image · calibrated</span> : <span>Imported image · markers are placed by hand</span>
        ) : currentMap?.kind === "sketch" ? (
          <span>Your sketch</span>
        ) : undefined
      }
      actions={
        <div className="map-actions">
          <Select value={effectiveMapId || (worldCapable ? WORLD_MAP : "")} onChange={(v) => { setMapId(v); setSelected(null); setCalibrating(false); }} options={mapOptions.length ? mapOptions : [{ value: "", label: "No maps yet" }]} title="Map" />
          <Btn small icon="image" onClick={() => void importImage()}>Import image</Btn>
          <Btn small icon="pen" onClick={() => void newSketch()}>New sketch</Btn>
          {currentMap ? (
            <>
              <Field className="small map-name" value={currentMap.name} onSave={(v) => void mutate((d) => repo.updateMap(d, currentMap.id, { name: v }))} />
              {currentMap.kind === "image" && worldCapable ? <Btn small icon="target" onClick={() => { setCalibrating(true); setCalibPicked(calibration?.points ?? []); }}>Calibrate</Btn> : null}
              <ConfirmBtn onConfirm={() => { void mutate((d) => repo.deleteMap(d, currentMap.id), "Map deleted."); setMapId(worldCapable ? WORLD_MAP : ""); }} confirmText="Delete map and its markers?" />
            </>
          ) : null}
        </div>
      }
    >
      <div className={`map-layout ${showList ? "with-list" : ""}`}>
        <div className="map-stage">
          {noMapYet ? (
            <Empty icon="map" title={`No map for ${game.short} yet`}>
              <p>Import a map image you own (a scan, a screenshot of the in-game map, a fan map you are allowed to use) and annotate it, or start a freehand sketch.</p>
              <div className="row center">
                <Btn kind="primary" icon="image" onClick={() => void importImage()}>Import a map image</Btn>
                <Btn icon="pen" onClick={() => void newSketch()}>Start a sketch</Btn>
              </div>
            </Empty>
          ) : (
            <MapCanvas
              width={dims.width}
              height={dims.height}
              base={base}
              fog={fog}
              style={style}
              toPx={markerToPx}
              markers={shownMarkers}
              selectedId={selected}
              onSelect={(id) => { setSelected(id); setAdding(null); }}
              onAddAt={(px, screen) => {
                setAdding({ px, screen, label: pendingLabel.current, category: "custom" });
                pendingLabel.current = "";
              }}
              movingId={moving}
              onMoveMarker={async (id, px) => {
                const pos = markersInWorld && fromPx ? fromPx(px) : px;
                await mutate((d) => repo.updateMarker(d, id, { x: pos.x, y: pos.y }));
                setMoving(null);
              }}
              colorOf={(m) => m.color ?? markerCategory(game, m.category).color}
              trail={isWorld && prefs.showTrail ? trail : undefined}
              replayTrail={isWorld ? replayTrail : null}
              labels={labels}
              lines={lines}
              points={points}
              player={player && toPx ? player : null}
              follow={follow && !!player}
              onUserPan={() => setFollow(false)}
              focus={focus}
              pickMode={calibrating}
              onPick={(px) => setCalibPicked([...calibPicked, { px: px.x, py: px.y, wx: NaN, wy: NaN }])}
              calibPoints={calibrating ? calibPicked.map((c) => ({ x: c.px, y: c.py })) : undefined}
              sketch={
                currentMap?.kind === "sketch"
                  ? {
                      items: sketchItems,
                      tool,
                      onAdd: (it) => saveSketch([...sketchItems, it]),
                      onErase: (i) => saveSketch(sketchItems.filter((_, j) => j !== i)),
                      onText: (px, screen) => setTextAt({ px, screen }),
                    }
                  : undefined
              }
            >
              <div className="map-ui map-compass">
                <Compass size={64} />
              </div>
              {isWorld && liveCell && !liveCell.exterior ? (
                <div className="map-ui interior-note">
                  <Icon name="door" size={16} /> Inside <strong>{cellLabel(liveCell)}</strong> — interiors have no world-map position.
                  {interiorExit ? <span className="muted"> The hollow ring marks the way out recorded in your game files.</span> : null}
                  <Btn small onClick={() => navigate({ section: "delves" })}>Dungeon notes</Btn>
                </div>
              ) : null}
              {player ? (
                <div className="map-ui follow-toggle">
                  <Btn small kind={follow ? "primary" : "normal"} icon="target" onClick={() => { setFollow(!follow); void savePrefs({ followPlayer: !follow }); }}>
                    {follow ? "Following you" : "Follow me"}
                  </Btn>
                  <Btn small icon="pin" title="Drop a marker where you stand" onClick={() => void mutate((d) => repo.addMarker(d, ch.id, { mapId: effectiveMapId, x: player.x, y: player.y, label: liveCell ? cellLabel(liveCell) : "Here", category: "revisit" }), "Marker placed at your position.")}>
                    Mark here
                  </Btn>
                </div>
              ) : null}
              {currentMap?.kind === "sketch" ? (
                <div className="map-ui sketch-tools" role="toolbar" aria-label="Sketch tools">
                  {(
                    [
                      ["hand", "expand", "Pan & select"],
                      ["pen", "pen", "Freehand"],
                      ["line", "arrowRight", "Line / corridor"],
                      ["rect", "rect", "Room"],
                      ["text", "text", "Label"],
                      ["erase", "eraser", "Erase (click a line)"],
                    ] as [SketchTool, string, string][]
                  ).map(([id, icon, title]) => (
                    <button key={id} className={tool === id ? "on" : ""} onClick={() => setTool(id)} title={title}>
                      <Icon name={icon} size={16} />
                    </button>
                  ))}
                  <button onClick={() => saveSketch(sketchItems.slice(0, -1))} title="Undo last stroke" disabled={!sketchItems.length}>
                    <Icon name="undo" size={16} />
                  </button>
                </div>
              ) : null}
              {adding ? (
                <form
                  className="map-ui add-marker panel"
                  style={{ left: Math.min(adding.screen.x, 9999), top: adding.screen.y }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createMarker(adding.px, adding.label.trim(), adding.category);
                    setAdding(null);
                  }}
                >
                  <input className="field" autoFocus placeholder="Name (e.g. Cave I haven't explored)" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} />
                  <Select value={adding.category} onChange={(v) => setAdding({ ...adding, category: v })} options={game.markerCategories.map((c) => ({ value: c.id, label: c.label }))} />
                  <Btn small kind="primary" type="submit" icon="check">Add</Btn>
                  <Btn small kind="ghost" icon="close" title="Cancel" onClick={() => setAdding(null)} />
                </form>
              ) : null}
              {textAt && currentMap?.kind === "sketch" ? (
                <form
                  className="map-ui add-marker panel"
                  style={{ left: textAt.screen.x, top: textAt.screen.y }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const s = (new FormData(e.currentTarget).get("label") as string)?.trim();
                    if (s) saveSketch([...sketchItems, { t: "text", x: textAt.px.x, y: textAt.px.y, s }]);
                    setTextAt(null);
                  }}
                >
                  <input name="label" className="field" autoFocus placeholder="Label text" onKeyDown={(e) => e.key === "Escape" && setTextAt(null)} />
                  <Btn small kind="primary" type="submit">Add</Btn>
                </form>
              ) : null}
              {moving ? <div className="map-ui moving-note">Click where the marker should go. <Btn small kind="ghost" onClick={() => setMoving(null)}>Cancel</Btn></div> : null}
              {selMarker ? <MarkerEditor marker={selMarker} worldInfo={worldInfo} onClose={() => setSelected(null)} onMove={() => setMoving(selMarker.id)} /> : null}
              {calibrating && currentMap ? <Calibrator map={currentMap} imgW={dims.width} imgH={dims.height} picked={calibPicked} setPicked={setCalibPicked} onDone={() => setCalibrating(false)} /> : null}
            </MapCanvas>
          )}
        </div>

        <aside className="map-side">
          <div className="map-side-head">
            <input className="field" placeholder={isWorld ? "Find a marker or place…" : "Find a marker…"} value={query} onChange={(e) => setQuery(e.target.value)} />
            <Btn small kind="ghost" icon="layers" title="Layers" onClick={() => setLayersOpen((v) => !v)} />
            <Btn small kind="ghost" icon={showList ? "chevron" : "layers"} title={showList ? "Hide list" : "Show list"} onClick={() => setShowList((v) => !v)} />
          </div>
          {searchHits.length ? (
            <div className="search-hits">
              {searchHits.map((h, i) => (
                <button key={i} className="list-item" onClick={() => toPx && setFocus({ pt: toPx(h.pt), key: `${h.label}${Date.now()}` })}>
                  <Icon name={h.kind === "marker" ? "pin" : "map"} size={14} /> {h.label}
                  {h.kind === "place" ? <Pill tone="game">game files</Pill> : null}
                </button>
              ))}
            </div>
          ) : null}
          {layersOpen ? (
            <div className="layers panel">
              {isWorld ? (
                <>
                  <Toggle on={prefs.showTrail} onChange={(v) => void savePrefs({ showTrail: v })} label="Travel history" title="Only recorded from live game data" />
                  <Toggle on={prefs.fogOfWar} onChange={(v) => void savePrefs({ fogOfWar: v })} label="Fog over unvisited areas" />
                  <Toggle on={prefs.referenceMode} onChange={(v) => void savePrefs({ referenceMode: v })} label="Reference: all place names from my game files" />
                  {prefs.referenceMode && atlas ? (
                    <>
                      <Toggle on={showTravel} onChange={setShowTravel} label={`Travel services (${gameTravelEdges(atlas.index.data).length} links)`} />
                      <Toggle on={showInterventions} onChange={setShowInterventions} label="Intervention markers" />
                    </>
                  ) : null}
                  <p className="muted small">Without reference mode, only places you have visited get labels — nothing is revealed for you.</p>
                </>
              ) : (
                <p className="muted small">Layers apply to the world map.</p>
              )}
              <div className="cat-filter">
                {game.markerCategories.map((c) => {
                  const n = markers.filter((m) => m.category === c.id).length;
                  const on = filterCats.includes(c.id);
                  return (
                    <button key={c.id} className={`chip ${on ? "on" : ""}`} onClick={() => setFilterCats(on ? filterCats.filter((x) => x !== c.id) : [...filterCats, c.id])} disabled={!n && !on}>
                      <span className="dot" style={{ background: c.color }} /> {c.label} <span className="muted">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {showList ? (
            <div className="marker-list">
              {shownMarkers.length === 0 ? (
                <p className="muted small">Double-click the map to add a marker. Name it, pick a category, done — you never leave the map.</p>
              ) : (
                shownMarkers
                  .slice()
                  .sort((a, b) => Number(a.done) - Number(b.done) || a.label.localeCompare(b.label))
                  .map((m) => (
                    <button key={m.id} className={`list-item ${m.id === selected ? "on" : ""} ${m.done ? "done" : ""}`} onClick={() => setSelected(m.id)}>
                      <span className="mk-dot" style={{ color: m.color ?? markerCategory(game, m.category).color }}>
                        <Icon name={MARKER_ICON[m.category] ?? "dot"} size={14} />
                      </span>
                      <span className="li-title">{m.label || "(unnamed)"}</span>
                      <span className="li-sub">{markerCategory(game, m.category).label}</span>
                    </button>
                  ))
              )}
            </div>
          ) : null}
          {isWorld && trail.length ? (
            <div className="trail-tools">
              <span className="muted small">{trail.length} trail points</span>
              <ConfirmBtn onConfirm={() => void mutate((d) => repo.clearTrail(d, ch.id), "Travel history cleared.")} confirmText="Clear travel history?">Clear trail</ConfirmBtn>
            </div>
          ) : null}
        </aside>
      </div>
      {replayTrail ? <div className="replay-flag"><Source kind="fixture" /> Replaying the synthetic test session</div> : null}
    </Page>
  );
}
