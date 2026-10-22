/**
 * Turns the atlas height image into a themed relief map (RGBA pixels).
 * Pure function - runs in the UI on a canvas and in the tests.
 */
import type { HeightImage } from "./atlas.ts";
import { NODATA } from "./atlas.ts";
import type { MapStyle } from "./themes.ts";

export type RGBA = [number, number, number, number];

export function parseColor(c: string): RGBA {
  const s = c.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 || h.length === 4 ? h.split("").map((x) => x + x).join("") : h;
    const n = parseInt(full.slice(0, 6), 16);
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return [p[0] || 0, p[1] || 0, p[2] || 0, Math.round((p[3] ?? 1) * 255)];
  }
  return [0, 0, 0, 255];
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export function rampColor(stops: [number, RGBA][], h: number): RGBA {
  if (h <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const [h0, c0] = stops[i - 1];
      const [h1, c1] = stops[i];
      return mix(c0, c1, (h - h0) / (h1 - h0));
    }
  }
  return stops[stops.length - 1][1];
}

export function renderRelief(img: HeightImage, style: MapStyle): Uint8ClampedArray {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const water = parseColor(style.water);
  const deep = parseColor(style.deep);
  const voidC = parseColor(style.void);
  const coast = parseColor(style.coast);
  const contourC = parseColor(style.contourColor);
  const stops = style.land.map(([hh, c]) => [hh, parseColor(c)] as [number, RGBA]);
  const at = (x: number, y: number) => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return data[yy * w + xx];
  };
  // Light from the north-west, like most hand-drawn relief maps.
  const lx = -0.6, ly = -0.6, lz = 0.53;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      const i = (y * w + x) * 4;
      let c: RGBA;
      if (v === NODATA) {
        c = voidC;
      } else if (v < 0) {
        // Shallows near the coast, deeper water further out.
        c = mix(water, deep, Math.min(1, -v / 400));
      } else {
        c = rampColor(stops, v);
        if (style.shade > 0) {
          const hx = at(x + 1, y) === NODATA ? v : at(x + 1, y);
          const hxm = at(x - 1, y) === NODATA ? v : at(x - 1, y);
          const hy = at(x, y + 1) === NODATA ? v : at(x, y + 1);
          const hym = at(x, y - 1) === NODATA ? v : at(x, y - 1);
          const dx = (hx - hxm) / 8;
          const dy = (hy - hym) / 8;
          const len = Math.hypot(dx, dy, 1);
          const dot = (-dx * lx - dy * ly + lz) / len;
          const k = 1 + (dot - 0.53) * style.shade * 1.4;
          c = [c[0] * k, c[1] * k, c[2] * k, c[3]];
        }
        if (style.contour > 0 && contourC[3] > 0) {
          const band = Math.floor(v / style.contour);
          if (Math.floor(at(x + 1, y) / style.contour) !== band || Math.floor(at(x, y + 1) / style.contour) !== band) {
            c = mix(c, [contourC[0], contourC[1], contourC[2], 255], contourC[3] / 255);
          }
        }
        // Coastline ink where land meets water or the edge of the world.
        const n = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
        if (n.some((q) => q < 0)) c = mix(c, coast, (coast[3] / 255) * 0.85);
      }
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = c[3];
    }
  }
  return out;
}
