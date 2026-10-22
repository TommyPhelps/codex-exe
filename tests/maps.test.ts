// Coordinate transforms, calibration, viewport math and atlas helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atlasWorldToPx, atlasPxToWorld, atlasSize, cellOfWorld, cellCenter, fitCalibration, applyAffine, invertAffine,
  zoomAt, screenToImage, imageToScreen, fitView, centerOn,
} from "../src/core/mapmath.ts";
import type { AtlasGrid, CalibPoint } from "../src/core/mapmath.ts";
import { findRoute, gameTravelEdges, modeForClass, settlementOf, placeLabels, indexAtlas, cellAt, exitFor, parseHeights, NODATA } from "../src/core/atlas.ts";
import type { AtlasData, TravelEdge } from "../src/core/atlas.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const grid: AtlasGrid = { minX: -18, maxX: 23, minY: -17, maxY: 28, spc: 32, cellSize: 8192 };

test("atlas: world <-> pixel round trip, north is up, cells line up", () => {
  const { width, height } = atlasSize(grid);
  assert.equal(width, 42 * 32);
  assert.equal(height, 46 * 32);
  // The south-west corner of cell (minX, minY) is the bottom-left pixel corner.
  const sw = atlasWorldToPx(grid, { x: grid.minX * 8192, y: grid.minY * 8192 });
  close(sw.x, 0);
  close(sw.y, height);
  // The north-west corner of the top row.
  const nw = atlasWorldToPx(grid, { x: grid.minX * 8192, y: (grid.maxY + 1) * 8192 });
  close(nw.y, 0);
  for (const w of [{ x: -22000.5, y: -15000 }, { x: 0, y: 0 }, { x: 123456, y: -98765 }]) {
    const p = atlasWorldToPx(grid, w);
    const back = atlasPxToWorld(grid, p);
    close(back.x, w.x, 1e-6);
    close(back.y, w.y, 1e-6);
  }
  // Moving north (larger y) moves up the image (smaller pixel y).
  assert.ok(atlasWorldToPx(grid, { x: 0, y: 1000 }).y < atlasWorldToPx(grid, { x: 0, y: 0 }).y);
});

test("cells: floor semantics for negative coordinates", () => {
  assert.deepEqual(cellOfWorld(8192, { x: -1, y: -8193 }), { gx: -1, gy: -2 });
  assert.deepEqual(cellOfWorld(8192, { x: 8191.9, y: 0 }), { gx: 0, gy: 0 });
  assert.deepEqual(cellCenter(8192, -3, -2), { x: -2.5 * 8192, y: -1.5 * 8192 });
  // The pixel at a cell centre maps back to that cell.
  const c = atlasWorldToPx(grid, cellCenter(8192, -3, -2));
  assert.deepEqual(cellOfWorld(8192, atlasPxToWorld(grid, c)), { gx: -3, gy: -2 });
});

test("calibration: two points recover a similarity transform with the y flip", () => {
  // Truth: 0.01 px per unit, image origin at world (-100000, 200000), north up.
  const truth = (wx: number, wy: number) => ({ px: (wx + 100000) * 0.01, py: (200000 - wy) * 0.01 });
  const pts: CalibPoint[] = [
    { ...truth(-50000, 150000), wx: -50000, wy: 150000 },
    { ...truth(60000, -20000), wx: 60000, wy: -20000 },
  ];
  const r = fitCalibration(pts);
  assert.ok(r.ok);
  if (!r.ok) return;
  close(r.calibration.rmsPx, 0, 1e-6);
  const p = applyAffine(r.calibration.transform, { x: 12345, y: 6789 });
  const t = truth(12345, 6789);
  close(p.x, t.px, 1e-6);
  close(p.y, t.py, 1e-6);
  const inv = invertAffine(r.calibration.transform)!;
  const w = applyAffine(inv, p);
  close(w.x, 12345, 1e-6);
  close(w.y, 6789, 1e-6);
});

test("calibration: two points also handle a rotated scan", () => {
  const ang = 0.3;
  const s = 0.02;
  const truth = (wx: number, wy: number) => {
    const x = wx, y = -wy;
    return { px: s * (Math.cos(ang) * x - Math.sin(ang) * y) + 400, py: s * (Math.sin(ang) * x + Math.cos(ang) * y) + 300 };
  };
  const r = fitCalibration([
    { ...truth(1000, 2000), wx: 1000, wy: 2000 },
    { ...truth(-30000, 45000), wx: -30000, wy: 45000 },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = applyAffine(r.calibration.transform, { x: 7000, y: -8000 });
  const t = truth(7000, -8000);
  close(p.x, t.px, 1e-6);
  close(p.y, t.py, 1e-6);
});

test("calibration: three or more points fit an affine (stretched scan) and report error", () => {
  const truth = (wx: number, wy: number) => ({ px: 0.011 * wx + 0.001 * wy + 50, py: -0.009 * wy + 0.0005 * wx + 700 });
  const world = [[0, 0], [80000, 10000], [-20000, 90000], [50000, 60000]];
  const pts = world.map(([wx, wy]) => ({ ...truth(wx, wy), wx, wy }));
  const r = fitCalibration(pts);
  assert.ok(r.ok);
  if (!r.ok) return;
  close(r.calibration.rmsPx, 0, 1e-6);
  const p = applyAffine(r.calibration.transform, { x: 10000, y: 20000 });
  const t = truth(10000, 20000);
  close(p.x, t.px, 1e-6);
  close(p.y, t.py, 1e-6);
  // A misplaced reference point shows up as error instead of silently warping.
  const bad = pts.map((p2, i) => (i === 3 ? { ...p2, px: p2.px + 40 } : p2));
  const rb = fitCalibration(bad);
  assert.ok(rb.ok && rb.calibration.rmsPx > 5);
});

test("calibration refuses degenerate input", () => {
  assert.equal(fitCalibration([]).ok, false);
  assert.equal(fitCalibration([{ px: 1, py: 1, wx: 0, wy: 0 }]).ok, false);
  assert.equal(fitCalibration([{ px: 1, py: 1, wx: 5, wy: 5 }, { px: 9, py: 9, wx: 5, wy: 5 }]).ok, false);
  const collinear = [0, 1, 2].map((i) => ({ px: i * 10, py: i * 10, wx: i * 1000, wy: i * 1000 }));
  assert.equal(fitCalibration(collinear).ok, false);
  assert.equal(fitCalibration([{ px: NaN, py: 1, wx: 0, wy: 0 }, { px: 1, py: 1, wx: 2, wy: 2 }]).ok, false);
});

test("viewport: zoom keeps the point under the cursor fixed", () => {
  const v = { ox: 100, oy: 50, scale: 0.5 };
  const s = { x: 300, y: 200 };
  const before = screenToImage(v, s);
  const z = zoomAt(v, s, 2);
  const after = screenToImage(z, s);
  close(before.x, after.x);
  close(before.y, after.y);
  assert.equal(z.scale, 1);
  const back = imageToScreen(z, after);
  close(back.x, s.x);
  assert.equal(zoomAt(v, s, 1e9).scale, 16);
  const f = fitView(1000, 500, 800, 800);
  const centre = screenToImage(f, { x: 400, y: 400 });
  close(centre.x, 500);
  close(centre.y, 250);
  const c = centerOn(f, { x: 10, y: 20 }, 800, 800);
  const cc = screenToImage(c, { x: 400, y: 400 });
  close(cc.x, 10);
  close(cc.y, 20);
});

const atlas: AtlasData = {
  version: 1,
  builtAt: "2026-10-20T00:00:00Z",
  gameId: "morrowind",
  plugins: [{ name: "Fixture.esm", bytes: 1 }],
  warnings: [],
  grid: { minX: 0, maxX: 3, minY: 0, maxY: 3, spc: 8, cellSize: 8192 },
  heights: "atlas.bin",
  cells: [
    { gx: 1, gy: 1, name: "Fixture Town", region: "Fixture Region" },
    { gx: 2, gy: 1, name: "Fixture Town", region: "Fixture Region" },
    { gx: 3, gy: 3, name: "Fixture Port", region: "Coast" },
    { gx: 0, gy: 0, name: "", region: "Coast" },
  ],
  doors: [{ x: 9000, y: 9000, to: "Fixture Town, Tower" }],
  exits: { "fixture town, tower": { x: 9000, y: 8800, via: "Fixture Town, Tower" } },
  travel: [
    { npcId: "a", npc: "Strider Driver", className: "Caravaner", cell: "Fixture Town", interior: false, x: 1, y: 1, dest: [{ x: 0, y: 0, cell: "Fixture Port" }, { x: 0, y: 0, cell: "Fixture Village" }] },
    { npcId: "b", npc: "Strider Driver Two", className: "Caravaner", cell: "Fixture Port", interior: false, x: 1, y: 1, dest: [{ x: 0, y: 0, cell: "Fixture Town" }] },
    { npcId: "c", npc: "Guide", className: "Guild Guide", cell: "Fixture Village, Guild", interior: true, x: 1, y: 1, dest: [{ x: 0, y: 0, cell: "Fixture City, Guild" }] },
    { npcId: "d", npc: "Ferry", className: "Fixture Ferryman", cell: "Fixture City", interior: false, x: 1, y: 1, dest: [{ x: 0, y: 0, cell: "" }] },
  ],
  markers: [],
  stats: { landCells: 4, cells: 4, interiors: 1, refs: 10, npcs: 4 },
};

test("atlas index: names, labels, lookups and exits", () => {
  const idx = indexAtlas(atlas);
  assert.equal(idx.named.length, 3);
  const labels = placeLabels(idx);
  const town = labels.find((l) => l.name === "Fixture Town")!;
  assert.equal(town.cells, 2);
  close(town.x, 2 * 8192);
  assert.equal(cellAt(idx, { x: 2.5 * 8192, y: 1.5 * 8192 })!.gx, 2);
  assert.equal(cellAt(idx, { x: -5, y: 0 }), undefined);
  assert.deepEqual(exitFor(atlas, "Fixture Town, Tower"), { x: 9000, y: 8800, via: "Fixture Town, Tower" });
  assert.equal(exitFor(atlas, "Unknown"), null);
  assert.equal(exitFor(null, "Fixture Town, Tower"), null);
});

test("travel: game-data edges, class labels and fewest-hop routes over verified links only", () => {
  assert.equal(settlementOf("Fixture Village, Guild"), "Fixture Village");
  assert.equal(modeForClass("Caravaner"), "Silt Strider");
  assert.equal(modeForClass("Shipmaster"), "Boat");
  assert.equal(modeForClass("Guild Guide"), "Guild Guide");
  assert.equal(modeForClass("Fixture Ferryman"), "Fixture Ferryman");
  const edges = gameTravelEdges(atlas);
  // The destination with no cell name is skipped rather than guessed.
  assert.equal(edges.length, 4);
  const mine: TravelEdge[] = [{ from: "Fixture Port", to: "Lonely Rock", fromLabel: "Fixture Port", toLabel: "Lonely Rock", mode: "Boat", source: "mine" }];
  const route = findRoute([...edges, ...mine], "fixture town", "Fixture City")!;
  assert.deepEqual(route.map((e) => [e.from, e.to, e.mode]), [
    ["Fixture Town", "Fixture Village", "Silt Strider"],
    ["Fixture Village", "Fixture City", "Guild Guide"],
  ]);
  assert.deepEqual(findRoute([...edges, ...mine], "Fixture Town", "Lonely Rock")!.map((e) => e.source), ["game", "mine"]);
  // Directed: no return route was recorded or found in the files.
  assert.equal(findRoute(edges, "Fixture City", "Fixture Town"), null);
  assert.deepEqual(findRoute(edges, "Fixture Town", "fixture town"), []);
});

test("height file parsing validates the header", () => {
  const w = 3, h = 2;
  const buf = new ArrayBuffer(28 + w * h * 2);
  const v = new DataView(buf);
  v.setUint32(0, 0x41584443, true);
  v.setUint32(4, 1, true);
  v.setInt32(8, -1, true);
  v.setInt32(12, -2, true);
  v.setUint32(16, w, true);
  v.setUint32(20, h, true);
  v.setUint32(24, 8, true);
  const d = new Int16Array(buf, 28);
  d.set([1, 2, 3, -4, NODATA, 6]);
  const r = parseHeights(buf);
  assert.equal(r.grid.minX, -1);
  assert.equal(r.image.width, 3);
  assert.deepEqual([...r.image.data], [1, 2, 3, -4, NODATA, 6]);
  assert.throws(() => parseHeights(new ArrayBuffer(10)));
  assert.throws(() => parseHeights(buf.slice(0, 30)));
});
