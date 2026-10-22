import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Marker } from "../../db/repo.ts";
import type { Pt, View } from "../../core/mapmath.ts";
import { fitView, imageToScreen, screenToImage, zoomAt, centerOn } from "../../core/mapmath.ts";
import { Icon, MARKER_ICON } from "../../ui/icons.tsx";
import type { MapStyle } from "../../core/themes.ts";

export type SketchItem =
  | { t: "path"; pts: [number, number][]; w?: number }
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "text"; x: number; y: number; s: string };

export type SketchTool = "hand" | "pen" | "rect" | "line" | "text" | "erase";

export interface MapLabel {
  name: string;
  x: number;
  y: number;
  weight: number;
}

export interface MapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  title: string;
}

export interface MapPoint {
  x: number;
  y: number;
  kind: string;
  label: string;
}

interface Props {
  width: number;
  height: number;
  base: HTMLCanvasElement | string | null;
  fog?: HTMLCanvasElement | null;
  style: MapStyle;
  toPx?: (w: Pt) => Pt;
  markers: Marker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddAt: (px: Pt, screen: Pt) => void;
  onMoveMarker?: (id: string, px: Pt) => void;
  movingId?: string | null;
  colorOf: (m: Marker) => string;
  trail?: { x: number; y: number; seg: number }[];
  replayTrail?: { x: number; y: number; seg: number }[] | null;
  labels?: MapLabel[];
  lines?: MapLine[];
  points?: MapPoint[];
  player?: { x: number; y: number; yaw?: number } | null;
  follow: boolean;
  onUserPan: () => void;
  focus?: { pt: Pt; key: string } | null;
  pickMode?: boolean;
  onPick?: (px: Pt) => void;
  calibPoints?: Pt[];
  sketch?: { items: SketchItem[]; tool: SketchTool; onAdd: (i: SketchItem) => void; onErase: (index: number) => void; onText: (px: Pt, screen: Pt) => void };
  children?: ReactNode;
}

function markerPx(m: Marker, toPx?: (w: Pt) => Pt): Pt {
  return toPx ? toPx({ x: m.x, y: m.y }) : { x: m.x, y: m.y };
}

export function MapCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const baseHost = useRef<HTMLDivElement>(null);
  const fogHost = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ ox: 0, oy: 0, scale: 1 });
  const fitted = useRef("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const draw = useRef<SketchItem | null>(null);
  const [drawing, setDrawing] = useState<SketchItem | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit the whole map the first time (and when the map itself changes).
  useEffect(() => {
    const key = `${p.width}x${p.height}`;
    if (fitted.current !== key && size.w > 10) {
      fitted.current = key;
      setView(fitView(p.width, p.height, size.w, size.h));
    }
  }, [p.width, p.height, size.w, size.h]);

  // Mount the base canvas / image.
  useEffect(() => {
    const host = baseHost.current;
    if (!host) return;
    host.innerHTML = "";
    if (p.base instanceof HTMLCanvasElement) {
      p.base.className = "map-base";
      host.appendChild(p.base);
    } else if (typeof p.base === "string") {
      const img = new Image();
      img.src = p.base;
      img.className = "map-base";
      img.draggable = false;
      host.appendChild(img);
    }
  }, [p.base]);

  useEffect(() => {
    const host = fogHost.current;
    if (!host) return;
    host.innerHTML = "";
    if (p.fog) {
      p.fog.className = "map-fog";
      host.appendChild(p.fog);
    }
  }, [p.fog]);

  // Follow the player.
  const playerPx = p.player && p.toPx ? p.toPx(p.player) : null;
  useEffect(() => {
    if (p.follow && playerPx) setView((v) => centerOn(v, playerPx, size.w, size.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.follow, playerPx?.x, playerPx?.y, size.w, size.h]);

  // External focus requests (search result, marker list, etc.).
  useEffect(() => {
    if (!p.focus) return;
    const target = p.focus.pt;
    setView((v) => {
      const zoomed = v.scale < 0.6 ? { ...v, scale: Math.max(v.scale, 0.9) } : v;
      return centerOn(zoomed, target, size.w, size.h);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus?.key]);

  const toLocal = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = toLocal(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => zoomAt(v, s, factor, 0.04, 24));
  };

  const tool = p.sketch?.tool ?? "hand";
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".marker, .map-ui")) return;
    const s = toLocal(e);
    const img = screenToImage(view, s);
    if (p.sketch && tool !== "hand" && e.button === 0) {
      if (tool === "pen") draw.current = { t: "path", pts: [[img.x, img.y]] };
      else if (tool === "rect") draw.current = { t: "rect", x: img.x, y: img.y, w: 0, h: 0 };
      else if (tool === "line") draw.current = { t: "line", x1: img.x, y1: img.y, x2: img.x, y2: img.y };
      else if (tool === "text") {
        p.sketch.onText(img, s);
        return;
      } else return;
      setDrawing(draw.current);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draw.current) {
      const img = screenToImage(view, toLocal(e));
      const d = draw.current;
      if (d.t === "path") {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(img.x - last[0], img.y - last[1]) * view.scale > 3) d.pts = [...d.pts, [img.x, img.y]];
      } else if (d.t === "rect") {
        draw.current = { ...d, w: img.x - d.x, h: img.y - d.y };
      } else if (d.t === "line") {
        draw.current = { ...d, x2: img.x, y2: img.y };
      }
      setDrawing({ ...draw.current } as SketchItem);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      p.onUserPan();
    }
    if (d.moved) setView((v) => ({ ...v, ox: d.ox - dx / v.scale, oy: d.oy - dy / v.scale }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (draw.current) {
      const d = draw.current;
      draw.current = null;
      setDrawing(null);
      const norm =
        d.t === "rect" ? { t: "rect" as const, x: Math.min(d.x, d.x + d.w), y: Math.min(d.y, d.y + d.h), w: Math.abs(d.w), h: Math.abs(d.h) } : d;
      const big = norm.t === "rect" ? norm.w * view.scale > 4 && norm.h * view.scale > 4 : norm.t === "line" ? Math.hypot(norm.x2 - norm.x1, norm.y2 - norm.y1) * view.scale > 4 : norm.t === "path" ? norm.pts.length > 1 : true;
      if (big) p.sketch?.onAdd(norm);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const s = toLocal(e);
      const img = screenToImage(view, s);
      if (p.pickMode && p.onPick) p.onPick(img);
      else if (p.movingId && p.onMoveMarker) p.onMoveMarker(p.movingId, img);
      else p.onSelect(null);
    }
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".marker, .map-ui")) return;
    if (p.sketch && tool !== "hand") return;
    const s = toLocal(e);
    p.onAddAt(screenToImage(view, s), s);
  };

  const zoomBy = (f: number) => setView((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, f, 0.04, 24));

  // ---- screen-space overlays
  const onScreen = (q: Pt, pad = 60) => q.x > -pad && q.y > -pad && q.x < size.w + pad && q.y < size.h + pad;
  const markerEls = p.markers
    .map((m) => ({ m, s: imageToScreen(view, markerPx(m, p.toPx)) }))
    .filter(({ s }) => onScreen(s));

  const labelEls = useMemo(() => {
    if (!p.labels?.length || !p.toPx) return [];
    const placed: { x: number; y: number; w: number }[] = [];
    const out: { name: string; s: Pt; big: boolean }[] = [];
    const sorted = [...p.labels].sort((a, b) => b.weight - a.weight);
    for (const l of sorted) {
      if (view.scale < 0.35 && l.weight < 2) continue;
      const s = imageToScreen(view, p.toPx({ x: l.x, y: l.y }));
      if (!onScreen(s, 0)) continue;
      const w = l.name.length * 7 + 10;
      if (placed.some((q) => Math.abs(q.x - s.x) < (q.w + w) / 2 && Math.abs(q.y - s.y) < 16)) continue;
      placed.push({ x: s.x, y: s.y, w });
      out.push({ name: l.name, s, big: l.weight >= 3 });
      if (out.length > 160) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.labels, view, size.w, size.h]);

  const segs = (trail: { x: number; y: number; seg: number }[] | undefined | null) => {
    if (!trail || !p.toPx) return [];
    const bySeg = new Map<number, string[]>();
    for (const q of trail) {
      const px = p.toPx({ x: q.x, y: q.y });
      const arr = bySeg.get(q.seg) ?? [];
      arr.push(`${px.x.toFixed(1)},${px.y.toFixed(1)}`);
      bySeg.set(q.seg, arr);
    }
    return [...bySeg.entries()].filter(([, pts]) => pts.length > 1);
  };
  const trailSegs = useMemo(() => segs(p.trail), [p.trail, p.toPx]); // eslint-disable-line react-hooks/exhaustive-deps
  const replaySegs = useMemo(() => segs(p.replayTrail), [p.replayTrail, p.toPx]); // eslint-disable-line react-hooks/exhaustive-deps

  const playerScreen = playerPx ? imageToScreen(view, playerPx) : null;
  const renderSketch = (it: SketchItem, i: number, live = false) => {
    const common = { key: live ? "live" : i, className: `sk ${tool === "erase" ? "erasable" : ""}`, onClick: tool === "erase" && !live ? () => p.sketch?.onErase(i) : undefined };
    switch (it.t) {
      case "path":
        return <polyline {...common} points={it.pts.map((q) => q.join(",")).join(" ")} />;
      case "rect":
        return <rect {...common} x={it.x} y={it.y} width={Math.max(0, it.w)} height={Math.max(0, it.h)} />;
      case "line":
        return <line {...common} x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} />;
      case "text":
        return (
          <text {...common} x={it.x} y={it.y} className={`sk-text ${tool === "erase" ? "erasable" : ""}`}>
            {it.s}
          </text>
        );
    }
  };

  return (
    <div
      ref={wrap}
      className={`map-canvas tool-${tool} ${p.pickMode ? "picking" : ""} ${p.movingId ? "moving" : ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{ background: p.style.void }}
    >
      <div className="map-world" style={{ width: p.width, height: p.height, transform: `scale(${view.scale}) translate(${-view.ox}px, ${-view.oy}px)` }}>
        <div ref={baseHost} className="map-base-host" />
        <div ref={fogHost} className="map-fog-host" />
        <svg className="map-vector" width={p.width} height={p.height} viewBox={`0 0 ${p.width} ${p.height}`}>
          {p.lines?.map((l, i) => {
            if (!p.toPx) return null;
            const a = p.toPx({ x: l.x1, y: l.y1 });
            const b = p.toPx({ x: l.x2, y: l.y2 });
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="travel-line">
                <title>{l.title}</title>
              </line>
            );
          })}
          {trailSegs.map(([seg, pts]) => (
            <polyline key={seg} points={pts.join(" ")} className="trail" style={{ stroke: p.style.trail }} />
          ))}
          {replaySegs.map(([seg, pts]) => (
            <polyline key={`r${seg}`} points={pts.join(" ")} className="trail replay" style={{ stroke: p.style.trail }} />
          ))}
          {p.sketch ? (
            <g className="sketch">
              {p.sketch.items.map((it, i) => renderSketch(it, i))}
              {drawing ? renderSketch(drawing, -1, true) : null}
            </g>
          ) : null}
        </svg>
      </div>

      <svg className="map-overlay" width={size.w} height={size.h}>
        {labelEls.map((l) => (
          <text key={l.name} x={l.s.x} y={l.s.y} className={`place-label ${l.big ? "big" : ""}`} style={{ fill: p.style.label }}>
            {l.name}
          </text>
        ))}
        {p.points?.map((pt, i) => {
          if (!p.toPx) return null;
          const s = imageToScreen(view, p.toPx(pt));
          if (!onScreen(s)) return null;
          return (
            <g key={i} transform={`translate(${s.x},${s.y})`} className={`map-point point-${pt.kind}`}>
              <circle r="6" />
              <title>{pt.label}</title>
            </g>
          );
        })}
        {p.calibPoints?.map((c, i) => {
          const s = imageToScreen(view, c);
          return (
            <g key={i} transform={`translate(${s.x},${s.y})`} className="calib-point">
              <path d="M-9 0H9M0 -9V9" />
              <circle r="5" />
              <text x="8" y="-8">{i + 1}</text>
            </g>
          );
        })}
        {playerScreen ? (
          <g transform={`translate(${playerScreen.x},${playerScreen.y}) rotate(${((p.player?.yaw ?? 0) * 180) / Math.PI})`} className="player">
            <circle r="13" className="player-halo" style={{ stroke: p.style.player }} />
            <path d="M0 -11 L7 8 L0 4 L-7 8 Z" style={{ fill: p.style.player }} />
          </g>
        ) : null}
      </svg>

      {markerEls.map(({ m, s }) => (
        <button
          key={m.id}
          className={`marker cat-${m.category} ${m.id === p.selectedId ? "on" : ""} ${m.done ? "done" : ""}`}
          style={{ left: s.x, top: s.y, ["--mk" as string]: p.colorOf(m) }}
          onClick={(e) => {
            e.stopPropagation();
            p.onSelect(m.id);
          }}
          title={m.label || "Marker"}
        >
          <span className="marker-pin">
            <Icon name={MARKER_ICON[m.category] ?? "dot"} size={14} />
          </span>
          {m.label && (view.scale > 0.5 || m.id === p.selectedId) ? <span className="marker-label">{m.label}</span> : null}
        </button>
      ))}

      <div className="map-ui map-zoom">
        <button onClick={() => zoomBy(1.4)} title="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.4)} title="Zoom out">−</button>
        <button onClick={() => setView(fitView(p.width, p.height, size.w, size.h))} title="Show the whole map">
          <Icon name="expand" size={14} />
        </button>
      </div>
      {p.children}
    </div>
  );
}
