import { useEffect, useRef, useState } from "react";
import { useApp, setState, navigate, db, activeCharacter } from "../state/store.ts";
import type { SectionId } from "../core/themes.ts";
import * as repo from "../db/repo.ts";
import type { SearchHit } from "../db/repo.ts";
import { Icon } from "../ui/icons.tsx";
import type { IconName } from "../ui/icons.tsx";
import { useTerm } from "../ui/theme.ts";
import { SECTIONS } from "../core/themes.ts";

const HIT_ICON: Record<SearchHit["type"], IconName> = {
  note: "journal",
  diary: "book",
  quest: "quests",
  npc: "person",
  marker: "pin",
  discovery: "discoveries",
  entry: "check",
  delve: "delves",
  route: "travel",
  visit: "map",
};

function targetOf(h: SearchHit): { section: SectionId; type: string; id: string; extra?: string } {
  switch (h.type) {
    case "note":
      return { section: "journal", type: "note", id: h.id };
    case "diary":
      return { section: "journal", type: "diary", id: h.id };
    case "quest":
      return { section: "quests", type: "quest", id: h.id };
    case "npc":
      return { section: "people", type: "npc", id: h.id };
    case "marker":
      return { section: "map", type: "marker", id: h.id, extra: h.scope };
    case "discovery":
      return { section: "discoveries", type: "discovery", id: h.id };
    case "delve":
      return { section: "delves", type: "delve", id: h.id };
    case "route":
      return { section: "travel", type: "route", id: h.id };
    case "visit":
      return { section: "map", type: "visit", id: h.id };
    case "entry": {
      const map: Record<string, SectionId> = { quest: "quests", delve: "delves", ledger: "ledger", char: "character", reminder: "resume", travel: "travel" };
      const section = map[h.scope ?? ""] ?? "resume";
      return { section, type: h.scope === "quest" ? "quest" : h.scope === "delve" ? "delve" : "entry", id: h.parentId ?? h.id };
    }
  }
}

export function Palette() {
  const ch = useApp(activeCharacter);
  const t = useTerm();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!ch) return;
    let alive = true;
    const handle = setTimeout(() => {
      void repo.searchAll(db(), ch.id, q).then((h) => {
        if (alive) {
          setHits(h);
          setSel(0);
        }
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q, ch]);
  const sections = q.trim()
    ? SECTIONS.filter((s) => t(s).toLowerCase().includes(q.trim().toLowerCase())).map((s) => ({ kind: "section" as const, id: s }))
    : [];
  const rows = [...sections, ...hits.map((h) => ({ kind: "hit" as const, hit: h }))];
  const close = () => setState({ paletteOpen: false });
  const open = (i: number) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === "section") navigate({ section: r.id });
    else navigate(targetOf(r.hit));
  };
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={q}
            placeholder="Search notes, quests, people, places, markers…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(rows.length - 1, s + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === "Enter") open(sel);
            }}
          />
        </div>
        <div className="palette-results">
          {q.trim().length < 2 ? <div className="muted palette-hint">Type at least two letters. Everything you recorded for {ch?.name} is searched — offline.</div> : null}
          {q.trim().length >= 2 && rows.length === 0 ? <div className="muted palette-hint">Nothing found for “{q}”.</div> : null}
          {rows.map((r, i) =>
            r.kind === "section" ? (
              <button key={`s-${r.id}`} className={`palette-row ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => open(i)}>
                <Icon name={r.id === "settings" ? "settings" : "arrowRight"} size={16} />
                <span className="pr-title">Go to {t(r.id)}</span>
              </button>
            ) : (
              <button key={`${r.hit.type}-${r.hit.id}`} className={`palette-row ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => open(i)}>
                <Icon name={HIT_ICON[r.hit.type]} size={16} />
                <span className="pr-title">{r.hit.title}</span>
                <span className="pr-snip">{r.hit.snippet}</span>
                <span className="pr-type">{r.hit.type === "entry" ? r.hit.scope : r.hit.type}</span>
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
