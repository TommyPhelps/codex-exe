/**
 * Coordinate transforms between game-world units and map-image pixels.
 *
 * Two kinds of map exist:
 *  - A TES3 atlas built from the player's own game files. Its calibration is
 *    exact: every exterior cell is `cellSize` world units square and the image
 *    was rendered from known grid bounds.
 *  - An imported image. It only gets a world transform if the user calibrates
 *    it with reference points; otherwise markers are placed by hand in image
 *    pixels and the player position is never drawn on it.
 */

export interface AtlasGrid {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Samples (pixels) per cell edge in the height image. */
  spc: number;
  cellSize: number;
}

export interface Pt {
  x: number;
  y: number;
}

export function atlasSize(g: AtlasGrid): { width: number; height: number } {
  return { width: (g.maxX - g.minX + 1) * g.spc, height: (g.maxY - g.minY + 1) * g.spc };
}

/** World units -> atlas pixels (y grows downward in the image, northward in the world). */
export function atlasWorldToPx(g: AtlasGrid, w: Pt): Pt {
  return {
    x: (w.x / g.cellSize - g.minX) * g.spc,
    y: (g.maxY + 1 - w.y / g.cellSize) * g.spc,
  };
}

export function atlasPxToWorld(g: AtlasGrid, p: Pt): Pt {
  return {
    x: (p.x / g.spc + g.minX) * g.cellSize,
    y: (g.maxY + 1 - p.y / g.spc) * g.cellSize,
  };
}

export function cellOfWorld(cellSize: number, w: Pt): { gx: number; gy: number } {
  return { gx: Math.floor(w.x / cellSize), gy: Math.floor(w.y / cellSize) };
}

export function cellCenter(cellSize: number, gx: number, gy: number): Pt {
  return { x: (gx + 0.5) * cellSize, y: (gy + 0.5) * cellSize };
}

// --------------------------------------------------------------- affine

/** px = a*wx + b*wy + c ; py = d*wx + e*wy + f */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface CalibPoint {
  px: number;
  py: number;
  wx: number;
  wy: number;
}

export interface Calibration {
  points: CalibPoint[];
  transform: Affine;
  /** Root-mean-square error in pixels over the reference points. */
  rmsPx: number;
}

export function applyAffine(t: Affine, w: Pt): Pt {
  return { x: t.a * w.x + t.b * w.y + t.c, y: t.d * w.x + t.e * w.y + t.f };
}

export function invertAffine(t: Affine): Affine | null {
  const det = t.a * t.e - t.b * t.d;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = t.e / det;
  const b = -t.b / det;
  const d = -t.d / det;
  const e = t.a / det;
  return { a, b, c: -(a * t.c + b * t.f), d, e, f: -(d * t.c + e * t.f) };
}

export type FitResult = { ok: true; calibration: Calibration } | { ok: false; error: string };

/**
 * Fits a world->image transform.
 *  - 2 points: similarity transform with a vertical flip (world north is up,
 *    image y grows down) - uniform scale, rotation and translation.
 *  - 3+ points: least-squares affine (handles stretched or skewed scans).
 */
export function fitCalibration(points: CalibPoint[]): FitResult {
  const pts = points.filter((p) => [p.px, p.py, p.wx, p.wy].every(Number.isFinite));
  if (pts.length < 2) return { ok: false, error: "Place at least two reference points." };
  let t: Affine | null;
  if (pts.length === 2) {
    t = fitSimilarityFlipped(pts[0], pts[1]);
    if (!t) return { ok: false, error: "The two reference points are too close together." };
  } else {
    t = fitAffineLeastSquares(pts);
    if (!t) return { ok: false, error: "The reference points are in a straight line. Spread them out." };
  }
  const rmsPx = Math.sqrt(
    pts.reduce((s, p) => {
      const q = applyAffine(t!, { x: p.wx, y: p.wy });
      return s + (q.x - p.px) ** 2 + (q.y - p.py) ** 2;
    }, 0) / pts.length,
  );
  return { ok: true, calibration: { points: pts, transform: t, rmsPx } };
}

function fitSimilarityFlipped(p: CalibPoint, q: CalibPoint): Affine | null {
  // Flip world y so both spaces have y growing downward, then fit
  // [px,py] = s*R*[wx,-wy] + T with complex-number arithmetic.
  const w1 = { x: p.wx, y: -p.wy };
  const w2 = { x: q.wx, y: -q.wy };
  const dwx = w2.x - w1.x;
  const dwy = w2.y - w1.y;
  const dpx = q.px - p.px;
  const dpy = q.py - p.py;
  const den = dwx * dwx + dwy * dwy;
  if (den < 1e-9 || Math.hypot(dpx, dpy) < 1e-6) return null;
  // z = dp / dw  (complex division)
  const re = (dpx * dwx + dpy * dwy) / den;
  const im = (dpy * dwx - dpx * dwy) / den;
  // p = z * w + T, with w = (wx, -wy)
  const c = p.px - (re * w1.x - im * w1.y);
  const f = p.py - (im * w1.x + re * w1.y);
  // Expand back to the original wy (which was negated).
  return { a: re, b: im, c, d: im, e: -re, f };
}

function fitAffineLeastSquares(pts: CalibPoint[]): Affine | null {
  // Normalise world coordinates first so the normal equations stay well
  // conditioned (world units are in the tens of thousands).
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.wx, 0) / n;
  const my = pts.reduce((a, p) => a + p.wy, 0) / n;
  const sc = Math.sqrt(pts.reduce((a, p) => a + (p.wx - mx) ** 2 + (p.wy - my) ** 2, 0) / n) || 1;
  let suu = 0, suv = 0, su = 0, svv = 0, sv = 0;
  let supx = 0, svpx = 0, spx = 0, supy = 0, svpy = 0, spy = 0;
  for (const p of pts) {
    const u = (p.wx - mx) / sc;
    const v = (p.wy - my) / sc;
    suu += u * u;
    suv += u * v;
    su += u;
    svv += v * v;
    sv += v;
    supx += u * p.px;
    svpx += v * p.px;
    spx += p.px;
    supy += u * p.py;
    svpy += v * p.py;
    spy += p.py;
  }
  const m = [
    [suu, suv, su],
    [suv, svv, sv],
    [su, sv, n],
  ];
  const r1 = solve3(m, [supx, svpx, spx]);
  const r2 = solve3(m, [supy, svpy, spy]);
  if (!r1 || !r2) return null;
  // px = r1[0]*u + r1[1]*v + r1[2], with u = (wx - mx)/sc, v = (wy - my)/sc
  const a = r1[0] / sc;
  const b = r1[1] / sc;
  const d = r2[0] / sc;
  const e = r2[1] / sc;
  return { a, b, c: r1[2] - a * mx - b * my, d, e, f: r2[2] - d * mx - e * my };
}

function solve3(m: number[][], v: number[]): [number, number, number] | null {
  const det = (k: number[][]) =>
    k[0][0] * (k[1][1] * k[2][2] - k[1][2] * k[2][1]) -
    k[0][1] * (k[1][0] * k[2][2] - k[1][2] * k[2][0]) +
    k[0][2] * (k[1][0] * k[2][1] - k[1][1] * k[2][0]);
  const d = det(m);
  const n = m[2][2];
  // With normalised inputs the determinant of a well-spread set is O(n^3).
  if (!Number.isFinite(d) || Math.abs(d) < 1e-6 * n * n * n) return null;
  const col = (i: number) => m.map((row, r) => row.map((x, c) => (c === i ? v[r] : x)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

// -------------------------------------------------------------- viewport

export interface View {
  /** Image pixel at the top-left of the viewport. */
  ox: number;
  oy: number;
  /** Screen pixels per image pixel. */
  scale: number;
}

export function screenToImage(v: View, s: Pt): Pt {
  return { x: v.ox + s.x / v.scale, y: v.oy + s.y / v.scale };
}

export function imageToScreen(v: View, p: Pt): Pt {
  return { x: (p.x - v.ox) * v.scale, y: (p.y - v.oy) * v.scale };
}

/** Zoom around a screen point, keeping the image point under it fixed. */
export function zoomAt(v: View, s: Pt, factor: number, minScale = 0.05, maxScale = 16): View {
  const scale = Math.min(maxScale, Math.max(minScale, v.scale * factor));
  const p = screenToImage(v, s);
  return { scale, ox: p.x - s.x / scale, oy: p.y - s.y / scale };
}

export function centerOn(v: View, p: Pt, width: number, height: number): View {
  return { ...v, ox: p.x - width / 2 / v.scale, oy: p.y - height / 2 / v.scale };
}

export function fitView(imgW: number, imgH: number, width: number, height: number, pad = 0.95): View {
  const scale = Math.max(0.01, Math.min(width / imgW, height / imgH) * pad);
  return { scale, ox: imgW / 2 - width / 2 / scale, oy: imgH / 2 - height / 2 / scale };
}
