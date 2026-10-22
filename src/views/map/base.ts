// Canvas generation for map backgrounds (cached per theme variant).
import type { HeightImage } from "../../core/atlas.ts";
import { renderRelief } from "../../core/relief.ts";
import type { MapStyle } from "../../core/themes.ts";
import type { AtlasGrid } from "../../core/mapmath.ts";

const cache = new Map<string, HTMLCanvasElement>();

export function reliefCanvas(key: string, img: HeightImage, style: MapStyle): HTMLCanvasElement {
  const k = `${key}|${JSON.stringify(style)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  const px = renderRelief(img, style);
  ctx.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  // Keep only a couple of variants in memory.
  if (cache.size > 3) cache.delete(cache.keys().next().value!);
  cache.set(k, c);
  return c;
}

/** A blank cartographer's sheet with a cell grid (used before an atlas exists). */
export function gridCanvas(grid: AtlasGrid, style: MapStyle): HTMLCanvasElement {
  const w = (grid.maxX - grid.minX + 1) * grid.spc;
  const h = (grid.maxY - grid.minY + 1) * grid.spc;
  const k = `grid|${w}x${h}|${grid.minX},${grid.maxY}|${style.void}|${style.grid}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = style.water;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = style.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= grid.maxX - grid.minX + 1; i++) {
    ctx.globalAlpha = (grid.minX + i) % 5 === 0 ? 1 : 0.45;
    ctx.beginPath();
    ctx.moveTo(i * grid.spc + 0.5, 0);
    ctx.lineTo(i * grid.spc + 0.5, h);
    ctx.stroke();
  }
  for (let j = 0; j <= grid.maxY - grid.minY + 1; j++) {
    ctx.globalAlpha = (grid.maxY + 1 - j) % 5 === 0 ? 1 : 0.45;
    ctx.beginPath();
    ctx.moveTo(0, j * grid.spc + 0.5);
    ctx.lineTo(w, j * grid.spc + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.label;
  ctx.font = `${Math.max(8, grid.spc * 0.45)}px serif`;
  ctx.globalAlpha = 0.5;
  for (let gx = grid.minX; gx <= grid.maxX; gx++) {
    for (let gy = grid.minY; gy <= grid.maxY; gy++) {
      if (gx % 5 === 0 && gy % 5 === 0) ctx.fillText(`${gx},${gy}`, (gx - grid.minX) * grid.spc + 3, (grid.maxY - gy) * grid.spc + grid.spc * 0.55);
    }
  }
  ctx.globalAlpha = 1;
  if (cache.size > 3) cache.delete(cache.keys().next().value!);
  cache.set(k, c);
  return c;
}

/** Fog over every exterior cell the character has not visited. */
export function fogCanvas(grid: AtlasGrid, visited: { gx: number; gy: number }[], style: MapStyle): HTMLCanvasElement {
  const w = (grid.maxX - grid.minX + 1) * grid.spc;
  const h = (grid.maxY - grid.minY + 1) * grid.spc;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = style.fog;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  for (const v of visited) {
    const x = (v.gx - grid.minX) * grid.spc;
    const y = (grid.maxY - v.gy) * grid.spc;
    // A soft-edged reveal: the cell itself fully, its neighbours partly.
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x - grid.spc, y - grid.spc, grid.spc * 3, grid.spc * 3);
    ctx.globalAlpha = 1;
    ctx.fillRect(x, y, grid.spc, grid.spc);
  }
  return c;
}
