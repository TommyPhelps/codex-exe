/** Small helpers shared by the data layer and the UI. No DOM, no Tauri. */

export function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

let counter = 0;
/** Sortable, collision-resistant id: time base36 + counter + random. */
export function newId(prefix = ""): string {
  counter = (counter + 1) % 1296;
  const t = Date.now().toString(36);
  const c = counter.toString(36).padStart(2, "0");
  const r = Math.floor(Math.random() * 36 ** 5)
    .toString(36)
    .padStart(5, "0");
  return `${prefix}${t}${c}${r}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    const v = JSON.parse(text) as unknown;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** "3 days ago", "just now" - for display only. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 0) return "just now";
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  const w = Math.round(d / 7);
  if (d < 60) return `${w} weeks ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} months ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Lower-cased, accent-light key used for matching place and NPC names. */
export function normKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function listJoin(items: string[], word = "and"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${word} ${items[items.length - 1]}`;
}

export function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}
