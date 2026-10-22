// Browser preview + screenshot harness (not part of the app).
//
// Builds the UI, serves it, and drives it in headless Chromium with a stand-in
// for window.__TAURI__ whose database is node:sqlite (the same SQL as the
// app). Seeds a demo journal, a PROCEDURAL demo terrain (not game data) and a
// synthetic bridge message, then captures screenshots at 1080p and 1440p.
//
//   node tools/preview.mjs            -> screenshots into dist-preview/shots
//   node tools/preview.mjs serve      -> keep the server running on :5180
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const R = resolve(import.meta.dirname, "..");
const PW = process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);
execFileSync(process.execPath, [join(R, "tools/build.mjs"), "--preview"], { env: { ...process.env, CODEX_OUT: "dist-preview" }, stdio: "inherit" });

const { nodeDriver } = await import(R + "/tests/nodeDriver.ts");
const { migrate } = await import(R + "/src/db/schema.ts");
const repo = await import(R + "/src/db/repo.ts");

// ------------------------------------------------------------ demo data
const db = nodeDriver();
await migrate(db);
const iso = (d, h = 12, m = 0) => new Date(Date.UTC(2026, 9, d, h, m)).toISOString();

async function seedMorrowind() {
  const c = await repo.createCharacter(db, "morrowind", "Nerevar");
  await repo.updateCharacter(db, c, {
    syncName: "Nerevar",
    sheet: {
      majorSkills: ["Long Blade", "Alteration", "Destruction", "Athletics", "Speechcraft"],
      minorSkills: ["Alchemy", "Light Armor", "Mysticism", "Security", "Restoration"],
      build: "Spellsword who walks everywhere. Levitation for the long trips, a blade for everything else.",
      priorities: "Get Alteration to 50 for better Levitate. Find a decent enchanted ring.",
      roleplay: "No stealing from temples.\nAlways pay the toll.",
    },
  });
  const s1 = await repo.startSession(db, c, "live", iso(16, 18));
  await repo.recordVisit(db, c, { name: "Seyda Neen", exterior: true, gx: -2, gy: -9 }, "live", iso(16, 18, 5));
  await repo.recordVisit(db, c, { name: "Balmora", exterior: true, gx: -3, gy: -2 }, "live", iso(16, 19));
  await repo.recordVisit(db, c, { name: "Balmora, Guild of Mages", exterior: false }, "live", iso(16, 19, 20));
  await repo.recordVisit(db, c, { name: "Caldera", exterior: true, gx: -2, gy: 2 }, "live", iso(16, 20, 10));
  await repo.addEvent(db, c, "quest", "Journal updated: The Missing Informant", "live", {}, iso(16, 19, 40));
  await repo.setSessionPlace(db, s1, "Caldera", "live");
  await repo.endSession(db, s1, { nextNote: "Check the buildings on the western bank before dark — and bring a light.", at: iso(16, 21, 30) });

  const q1 = await repo.createQuest(db, c, "The Missing Informant", {
    lastKnown: "Someone in Balmora told me to look near the river.",
    nextAction: "Explore the western bank.",
  });
  await repo.updateQuest(db, q1, { notes: "I searched the eastern bank but haven't checked the buildings." });
  await repo.addEntry(db, c, { scope: "quest", parentId: q1, kind: "clue", title: "Last seen near the river, after dark", place: "Balmora" });
  await repo.addEntry(db, c, { scope: "quest", parentId: q1, kind: "clue", title: "Eastern bank searched — nothing", place: "Balmora" });
  await repo.addEntry(db, c, { scope: "quest", parentId: q1, kind: "question", title: "Who else was asking about him?" });
  await repo.addEntry(db, c, { scope: "quest", parentId: q1, kind: "item", title: "A light source" });
  const q2 = await repo.createQuest(db, c, "Rare ingredients for the alchemist", { lastKnown: "She wants three of something that grows on the coast.", nextAction: "Ask around Seyda Neen." });
  await repo.createQuest(db, c, "Debt to the pawnbroker", { lastKnown: "Promised to pay back 300 gold.", nextAction: "" });
  const q4 = await repo.createQuest(db, c, "Escort to the shrine");
  await repo.updateQuest(db, q4, { status: "completed" });
  const synced = await repo.upsertSyncedQuest(db, c, { questId: "demo_journal_entry", questName: "A quest from your game journal", index: 10, text: "(In the app, the bridge imports your real journal text here.)" }, iso(16, 19));

  const n1 = await repo.createNpc(db, c, { name: "Trainer in Balmora", place: "Balmora", occupation: "Trainer", services: "Trains Long Blade", notes: "I found a trainer in Balmora, but I couldn't afford the training." });
  await repo.updateNpc(db, n1, { facts: { worth: "Come back with 2,000 gold." } });
  const n2 = await repo.createNpc(db, c, { name: "The worried brother", place: "Balmora, near the bridge", notes: "Asked me to find his brother. Nervous, kept looking at the guards." });
  await repo.updateNpc(db, n2, { facts: { asked: "Find his missing brother (the informant).", promised: "I said I'd look before the end of the week." } });
  await repo.createNpc(db, c, { name: "Alchemist", place: "Caldera", occupation: "Alchemist", notes: "Buys ingredients at fair prices." });
  await repo.createNpc(db, c, { name: "Ferry captain", place: "Seyda Neen docks", occupation: "Shipmaster" });
  await repo.link(db, c, { type: "quest", id: q1 }, { type: "npc", id: n2 });
  await repo.link(db, c, { type: "npc", id: n1 }, { type: "npc", id: n2 }, "knows");

  const m1 = await repo.addMarker(db, c, { mapId: "world", x: -22300, y: -14800, category: "quest", label: "River bank — informant?", note: "Western bank not searched yet." });
  await repo.addMarker(db, c, { mapId: "world", x: -26800, y: -9400, category: "dungeon", label: "Cave I haven't explored", note: "Heard something inside. Came back later." });
  await repo.addMarker(db, c, { mapId: "world", x: -20500, y: -16100, category: "merchant", label: "Cheap potions" });
  await repo.addMarker(db, c, { mapId: "world", x: -23000, y: -15600, category: "trainer", label: "Long Blade trainer" });
  await repo.addMarker(db, c, { mapId: "world", x: -14200, y: 21500, category: "home", label: "Stash: extra armor" });
  await repo.addMarker(db, c, { mapId: "world", x: -12400, y: -72000, category: "revisit", label: "Docks — ferry" });
  await repo.addMarker(db, c, { mapId: "world", x: 5200, y: 9400, category: "danger", label: "Something big lives here" });
  await repo.link(db, c, { type: "quest", id: q1 }, { type: "marker", id: m1 });
  // A recorded trail (two segments: a walk, then a jump).
  let seg = 1;
  for (let i = 0; i < 40; i++) await repo.addTrailPoint(db, c, s1, seg, -16000 - i * 260 + Math.sin(i / 4) * 300, -70000 + i * 1400, iso(16, 18, i));
  seg = 2;
  for (let i = 0; i < 30; i++) await repo.addTrailPoint(db, c, s1, seg, -24000 + i * 120, -15000 + i * 1200 + Math.cos(i / 3) * 400, iso(16, 20, i));

  await repo.addNote(db, { characterId: c, body: "Come back when I have 2,000 gold. #training", place: "Balmora", placeSource: "live", gameDate: "16 Last Seed, 3E 427", at: iso(16, 19, 10), pinned: true, tags: ["training"] });
  await repo.addNote(db, { characterId: c, body: "Shopping list:\n- [x] Repair hammer\n- [ ] Restore Health potions\n- [ ] Something for the swamp fever", at: iso(16, 19, 30), tags: [] });
  await repo.addNote(db, { characterId: c, body: "The **silt strider** here goes south. Cheaper than walking through the hills at night.", place: "Balmora", placeSource: "manual", at: iso(16, 20) });
  await repo.addNote(db, { characterId: c, kind: "diary", title: "16 Last Seed", body: "Arrived in Balmora with mud to the knees. Everyone here seems to owe someone money, and now so do I.\n\nThe brother's story doesn't add up. Tomorrow: the western bank.", at: iso(16, 21) });
  await repo.addNote(db, { characterId: c, kind: "diary", title: "17 Last Seed", body: "Ash in the wind all morning. Bought a lantern I can't really afford.", at: iso(17, 9) });

  const d1 = await repo.createDelve(db, c, "Cave I haven't explored", "north of Balmora");
  await repo.updateDelve(db, d1, { status: "left", reason: "Needed better equipment — something on the lower level hits far too hard." });
  await repo.addEntry(db, c, { scope: "delve", parentId: d1, kind: "entrance", title: "Main entrance faces the river" });
  await repo.addEntry(db, c, { scope: "delve", parentId: d1, kind: "locked", title: "Iron door, second room on the left" });
  await repo.addEntry(db, c, { scope: "delve", parentId: d1, kind: "key", title: "Key probably on the bandit leader" });
  await repo.addEntry(db, c, { scope: "delve", parentId: d1, kind: "loot", title: "Left a heavy shield by the stairs" });
  await repo.addEntry(db, c, { scope: "delve", parentId: d1, kind: "unexplored", title: "Flooded passage going north" });
  const sk = await repo.createMap(db, c, "morrowind", "sketch", "Cave I haven't explored (sketch)");
  await repo.updateMap(db, sk, { sketch: JSON.stringify({ items: [
    { t: "rect", x: 300, y: 300, w: 420, h: 260 }, { t: "rect", x: 900, y: 360, w: 300, h: 220 }, { t: "line", x1: 720, y1: 430, x2: 900, y2: 460 },
    { t: "path", pts: [[1200, 470], [1320, 520], [1400, 640], [1430, 820], [1380, 980]] }, { t: "text", x: 330, y: 360, s: "entrance" }, { t: "text", x: 920, y: 420, s: "locked door" }, { t: "text", x: 1400, y: 1010, s: "flooded?" },
  ] }) });
  await repo.updateDelve(db, d1, { mapId: sk });
  await repo.createDelve(db, c, "Old tomb by the coast", "Bitter Coast");

  await repo.addEntry(db, c, { scope: "ledger", kind: "storage", title: "Extra armor in a chest", place: "Caldera, my rented room" });
  await repo.addEntry(db, c, { scope: "ledger", kind: "merchant", title: "Cheap potions, fair prices", place: "Balmora" });
  await repo.addEntry(db, c, { scope: "ledger", kind: "trainer", title: "Long Blade — too expensive for now", place: "Balmora" });
  await repo.addEntry(db, c, { scope: "ledger", kind: "buy", title: "Restore Health potions" });
  await repo.addEntry(db, c, { scope: "ledger", kind: "sell", title: "Spare iron helmet" });
  await repo.addEntry(db, c, { scope: "reminder", kind: "level", title: "Go back to the Long Blade trainer" });
  await repo.addEntry(db, c, { scope: "reminder", kind: "place", title: "Sell the spare helmet", place: "Caldera" });
  await repo.addEntry(db, c, { scope: "char", kind: "goal", title: "Become a powerful mage — without giving up the blade" });
  await repo.addEntry(db, c, { scope: "char", kind: "faction", title: "Mages Guild — Associate", body: "Need more Alteration before the next rank." });
  await repo.addEntry(db, c, { scope: "char", kind: "alchemy", title: "Coastal plant — restores fatigue (confirmed)" });
  await repo.addRoute(db, c, { fromPlace: "Balmora", toPlace: "Seyda Neen", mode: "Silt Strider" });
  await repo.addRoute(db, c, { fromPlace: "Seyda Neen", toPlace: "Balmora", mode: "Silt Strider" });
  await repo.addRoute(db, c, { fromPlace: "Balmora", toPlace: "Caldera", mode: "Guild Guide", notes: "Mages Guild" });
  await repo.addRoute(db, c, { fromPlace: "Caldera", toPlace: "Balmora", mode: "Guild Guide" });
  await repo.addDiscovery(db, c, { category: "Places", name: "Balmora", source: "sync", ref: "place:ext:-3,-2", body: "First visited (recorded by the game bridge)." });
  await repo.addDiscovery(db, c, { category: "Rumors", name: "Smugglers on the coast", body: "Overheard at the tavern. Might be connected to the informant." });
  await repo.addDiscovery(db, c, { category: "Factions", name: "Mages Guild", body: "Joined. Guild guides can send me between halls." });
  await repo.saveLive(db, c, {
    receivedAt: iso(16, 21, 29),
    cell: { name: "Caldera", exterior: true, gx: -2, gy: 2 },
    character: liveCharacter(),
  });
  void q2; void synced;
  return c;
}

function liveCharacter() {
  const skills = {};
  for (const [i, n] of ["Block", "Armorer", "Medium Armor", "Heavy Armor", "Blunt Weapon", "Long Blade", "Axe", "Spear", "Athletics", "Enchant", "Destruction", "Alteration", "Illusion", "Conjuration", "Mysticism", "Restoration", "Alchemy", "Unarmored", "Security", "Sneak", "Acrobatics", "Light Armor", "Short Blade", "Marksman", "Mercantile", "Speechcraft", "Hand-to-hand"].entries()) {
    skills[n] = { base: 10 + ((i * 7) % 32), current: 10 + ((i * 7) % 32) };
  }
  return {
    name: "Nerevar", race: "Dark Elf", class: "Spellsword", birthsign: "The Lord", level: 6,
    health: { base: 92, current: 71 }, magicka: { base: 120, current: 96 }, fatigue: { base: 230, current: 205 }, gold: 412,
    attributes: { strength: { base: 45, current: 45 }, intelligence: { base: 52, current: 57 }, willpower: { base: 48, current: 48 }, agility: { base: 40, current: 40 }, speed: { base: 51, current: 51 }, endurance: { base: 44, current: 44 }, personality: { base: 35, current: 35 }, luck: { base: 40, current: 40 } },
    skills, equipped: ["Iron Longsword", "Netch Leather Cuirass", "Common Shoes"], spell: "Fire Bite", effects: ["Fortify Intelligence"],
    inventory: [{ name: "Iron Longsword", count: 1 }, { name: "Restore Health potion", count: 2 }, { name: "Lantern", count: 1 }, { name: "Spare iron helmet", count: 1 }],
  };
}

async function seedOthers() {
  const games = [
    ["daggerfall", "Lyra of Daggerfall"],
    ["oblivion", "Hero of the Gate"],
    ["skyrim", "Ysolde"],
    ["falloutnv", "The Courier"],
    ["kotor", "Revan"],
    ["gothic", "The Nameless"],
    ["stalker", "Marked One"],
  ];
  const ids = {};
  for (const [g, name] of games) {
    const c = await repo.createCharacter(db, g, name);
    ids[g] = c;
    const q = await repo.createQuest(db, c, g === "stalker" ? "Find the stash near the tunnel" : g === "falloutnv" ? "Track down the man in the checkered suit" : "Find the missing caravan", { lastKnown: "Last seen heading north along the road.", nextAction: "Ask at the next settlement." });
    await repo.addEntry(db, c, { scope: "quest", parentId: q, kind: "clue", title: "Broken wheel by the bridge" });
    await repo.createQuest(db, c, "Clear the old mine");
    await repo.createNpc(db, c, { name: "Trader by the gate", place: "the outer camp", notes: "Sells ammunition and rumours." });
    await repo.addNote(db, { characterId: c, body: "Remember to sell the spare gear before heading out.", at: iso(18, 10) });
    const s = await repo.startSession(db, c, "manual", iso(18, 9));
    await repo.endSession(db, s, { nextNote: "Head north and check the old mine entrance.", lastPlace: "the outer camp", lastPlaceSource: "manual", at: iso(18, 11) });
    const d = await repo.createDelve(db, c, "The old mine", "north road");
    await repo.updateDelve(db, d, { status: "left", reason: "Ran out of torches on the second level." });
  }
  return ids;
}

// ------------------------------------------- procedural demo terrain
function demoAtlas() {
  const grid = { minX: -18, maxX: 22, minY: -17, maxY: 26, spc: 16, cellSize: 8192 };
  const w = (grid.maxX - grid.minX + 1) * grid.spc;
  const h = (grid.maxY - grid.minY + 1) * grid.spc;
  const data = new Int16Array(w * h);
  // Value noise
  const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y) => { let s = 0, amp = 1, f = 1; for (let o = 0; o < 5; o++) { s += amp * noise(x * f, y * f); amp *= 0.5; f *= 2.03; } return s / 1.94; };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const nx = px / w - 0.5, ny = py / h - 0.5;
    const r = Math.hypot(nx * 1.15, ny * 0.95);
    const base = 1 - r * 2.1;
    const n = fbm(px / 70, py / 70);
    const peak = Math.exp(-((nx - 0.05) ** 2 + (ny + 0.02) ** 2) / 0.012) * 1.6;
    const e = base + (n - 0.5) * 0.9 + peak;
    data[py * w + px] = Math.round(e * 900 - 120);
  }
  const atlas = {
    version: 1, builtAt: "2026-10-20T00:00:00.000Z", gameId: "morrowind", plugins: [{ name: "PROCEDURAL-DEMO-TERRAIN", bytes: 0 }],
    warnings: ["Preview harness: procedurally generated demo terrain, not game data."], grid, heights: "atlas.bin",
    cells: [], doors: [], exits: {}, travel: [], markers: [], stats: { landCells: 0, cells: 0, interiors: 0, refs: 0, npcs: 0 },
  };
  const header = new ArrayBuffer(28);
  const v = new DataView(header);
  v.setUint32(0, 0x41584443, true); v.setUint32(4, 1, true); v.setInt32(8, grid.minX, true); v.setInt32(12, grid.minY, true); v.setUint32(16, w, true); v.setUint32(20, h, true); v.setUint32(24, grid.spc, true);
  const bin = new Uint8Array(28 + data.byteLength);
  bin.set(new Uint8Array(header), 0);
  bin.set(new Uint8Array(data.buffer), 28);
  return { json: JSON.stringify(atlas), bin: Array.from(bin) };
}

const mw = await seedMorrowind();
const others = await seedOthers();
await repo.saveSetting(db, "activeCharacter", mw);
const atlas = demoAtlas();

// ------------------------------------------------------------- server
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf" };
const out = join(R, "dist-preview");
const srv = createServer((req, res) => {
  const p = join(out, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": mime[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(5180);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await page.exposeFunction("__codexCall", async (cmd, args) => {
  switch (cmd) {
    case "db_select": return db.select(args.sql, args.params);
    case "db_execute": return db.execute(args.sql, args.params);
    case "db_batch": return db.batch(args.statements);
    case "app_info": return { version: "1.0.0", dataDir: "C:\\Users\\Tommy\\AppData\\Roaming\\dev.tommy.codex", dbPath: "C:\\Users\\Tommy\\AppData\\Roaming\\dev.tommy.codex\\codex.sqlite3", backupsDir: "", portable: false };
    case "read_atlas": return args.gameId === "morrowind" ? { json: atlas.json, heightsPath: "atlas.bin" } : null;
    case "read_atlas_heights": return atlas.bin;
    case "set_watched_executables": return ["morrowind.exe"];
    case "list_db_snapshots": return [{ path: "x", name: "codex-20261020-090000-daily.sqlite3", bytes: 182000, modifiedMs: Date.now() - 3600e3 }];
    case "user_dirs": return { documents: "C:\\Users\\Tommy\\Documents", openmwUser: "C:\\Users\\Tommy\\Documents\\My Games\\OpenMW", openmwCfg: "C:\\Users\\Tommy\\Documents\\My Games\\OpenMW\\openmw.cfg", openmwLog: "C:\\Users\\Tommy\\Documents\\My Games\\OpenMW\\openmw.log", openmwScreenshots: "C:\\Users\\Tommy\\Documents\\My Games\\OpenMW\\screenshots" };
    case "mwse_status": return { gameDirOk: true, mwseInstalled: true, bridgeInstalled: true, bridgeCurrent: true, statusFile: "", scriptPath: "", morrowindIni: "" };
    case "bridge_set_sources": case "set_hotkeys": case "snapshot_db": case "set_always_on_top": return null;
    default: return null;
  }
});
await page.addInitScript(() => {
  const handlers = {};
  window.__TAURI__ = {
    core: { invoke: async (cmd, args) => { const r = await window.__codexCall(cmd, args ?? {}); return cmd === "read_atlas_heights" ? new Uint8Array(r).buffer : r; } },
    event: { listen: async (ev, h) => { (handlers[ev] ||= []).push(h); return () => {}; } },
  };
  window.__emit = (ev, payload) => (handlers[ev] || []).forEach((h) => h({ payload }));
  try { localStorage.setItem("codex.mode", "normal"); } catch {}
});

const shots = join(out, "shots");
mkdirSync(shots, { recursive: true });
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/${name}.png` }); console.log("shot", name); };
const nav = async (label) => { await page.locator(".nav .nav-item, .term-group, .term-sub").filter({ hasText: label }).first().click(); await page.waitForTimeout(250); };
const liveDoc = (x, y, cell, seq) => JSON.stringify({
  protocol: "codex-bridge", v: 1, engine: "mwse", session: "previewsession", seq, caps: ["cell", "position", "time", "journal", "quests", "character", "stats", "equipment", "spell", "effects", "inventory", "events"], engineVersion: "MWSE (preview)",
  state: { menu: false, cell, pos: { x, y, z: 300, yaw: 0.6 }, time: { year: 427, month: 8, day: 17, hour: 10.5 }, character: liveCharacter() }, events: [],
});

await page.goto("http://localhost:5180/");
await page.waitForSelector(".app, .welcome", { timeout: 15000 });
if (process.argv[2] === "serve") { console.log("serving on http://localhost:5180 — Ctrl+C to stop"); await new Promise(() => {}); }

// Live: a synthetic bridge message so the header and map show live mode.
await page.evaluate((d) => window.__emit("processes", ["morrowind.exe"]), null);
await page.evaluate(async ({ a, b }) => { window.__emit("bridge-doc", { engine: "mwse", text: a, mtimeMs: Date.now() }); await new Promise((r) => setTimeout(r, 300)); window.__emit("bridge-doc", { engine: "mwse", text: b, mtimeMs: Date.now() }); },
  { a: liveDoc(-21800, -15200, { name: "Balmora", exterior: true, gx: -3, gy: -2, region: "West Gash Region" }, 1), b: liveDoc(-21500, -14600, { name: "Balmora", exterior: true, gx: -3, gy: -2, region: "West Gash Region" }, 2) });
await page.waitForTimeout(600);

await shot("01-resume-1080p");
await nav("Map");
await page.waitForSelector(".map-canvas");
await page.waitForTimeout(500);
await shot("02-map-1080p");
await page.locator(".marker-list .list-item").filter({ hasText: "River bank" }).click();
await shot("03-map-marker-1080p");
await nav("Quests");
await page.locator(".list-item").filter({ hasText: "The Missing Informant" }).click();
await shot("04-quest-detail-1080p");
await page.getByText("Show my notes").click(); await page.getByText("Next step").click();
await page.locator(".hint-ladder").scrollIntoViewIfNeeded();
await shot("05-quest-hints-1080p");
await nav("People");
await page.locator(".list-item").filter({ hasText: "The worried brother" }).click();
await shot("06-people-1080p");
await nav("Journal");
await shot("07-journal-notes-1080p");
await page.getByRole("tab", { name: "Diary" }).click();
await shot("08-journal-diary-1080p");
await page.getByRole("tab", { name: "Timeline" }).click();
await shot("09-journal-timeline-1080p");
await nav("Character");
await shot("10-character-1080p");
await nav("Travel");
await page.locator("input[placeholder^='From (now']").fill("Seyda Neen");
await page.locator("input[placeholder='To']").first().fill("Caldera");
await shot("11-travel-1080p");
await nav("Caves");
await page.locator(".list-item").first().click();
await shot("12-dungeon-1080p");
await nav("Stores");
await shot("13-ledger-1080p");
await nav("Discoveries");
await shot("14-discoveries-1080p");
await nav("Settings");
await page.getByRole("tab", { name: "Game & bridge" }).click();
await shot("15-settings-bridge-1080p");
await page.getByRole("tab", { name: "Appearance" }).click();
await shot("16-settings-appearance-1080p");
await page.keyboard.press("Control+k"); await page.keyboard.type("balmora");
await shot("17-search-1080p");
await page.keyboard.press("Escape");
await nav("Where Was I");
await page.keyboard.press("Control+n");
await page.keyboard.type("The guard at the bridge mentioned a hidden cellar. #informant");
await shot("18-quick-note-1080p");
await page.keyboard.press("Escape");

// 1440p
await page.setViewportSize({ width: 2560, height: 1440 });
await nav("Where Was I");
await shot("20-resume-1440p");
await nav("Map");
await page.waitForTimeout(500);
await shot("21-map-1440p");
await nav("Quests");
await page.locator(".list-item").filter({ hasText: "The Missing Informant" }).click();
await shot("22-quests-1440p");

// Sketch map of the dungeon
await page.setViewportSize({ width: 1920, height: 1080 });
await page.evaluate(() => localStorage.setItem(`codex.map.${document.querySelector(".char-switch").value}`, ""));
await nav("Caves");
await page.locator(".list-item").first().click();
await page.getByRole("button", { name: "Open" }).click();
await page.waitForTimeout(500);
await shot("23-dungeon-sketch-1080p");

// Lamplight variant
await nav("Settings");
await page.getByRole("tab", { name: "Appearance" }).click();
await page.getByRole("button", { name: "Lamplight" }).click();
await nav("Where Was I");
await shot("24-morrowind-lamplight-1080p");
await nav("Map"); await page.waitForTimeout(400);
await shot("25-map-lamplight-1080p");
await nav("Settings");
await page.getByRole("tab", { name: "Appearance" }).click();
await page.getByRole("button", { name: "Parchment" }).click();

// Compact second-monitor sidebar
await page.setViewportSize({ width: 560, height: 1040 });
await page.locator("button[title^='Compact mode']").click();
await nav("Where Was I");
await shot("26-compact-narrow");
await page.locator("button[title^='Compact mode']").click();
await page.setViewportSize({ width: 1920, height: 1080 });

// The other game themes
const order = [["daggerfall", "Lyra"], ["oblivion", "Hero of"], ["skyrim", "Ysolde"], ["falloutnv", "Courier"], ["kotor", "Revan"], ["gothic", "Nameless"], ["stalker", "Marked"]];
let n = 30;
for (const [g, who] of order) {
  const value = await page.locator(".char-switch option").filter({ hasText: who }).getAttribute("value");
  await page.selectOption(".char-switch", value);
  await page.waitForTimeout(500);
  await page.locator(".nav-item, .term-group").first().click();
  await page.waitForTimeout(300);
  await shot(`${n++}-${g}-resume-1080p`);
  const questsTab = page.locator(".nav-item, .term-sub, .term-group").filter({ hasText: /Quest|QUESTS|Tasks|Missions/ }).first();
  if (g === "falloutnv") { await page.locator(".term-group").filter({ hasText: "DATA" }).click(); }
  else await questsTab.click();
  await page.waitForTimeout(250);
  await page.locator(".list-item").first().click();
  await shot(`${n++}-${g}-quests-1080p`);
}
void others;
await browser.close();
srv.close();
