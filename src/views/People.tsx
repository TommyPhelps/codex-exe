import { useEffect, useMemo, useState } from "react";
import { useApp, useQuery, mutate, setState, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Npc, NpcFacts } from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Empty, Field, TextBlock, QuickAdd, ListDetail } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { LinkChips } from "../ui/links.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { exampleText } from "../core/games.ts";
import { parseNpcQuick } from "../core/quick.ts";
import { truncate } from "../core/util.ts";

type FactKey = "place" | "faction" | "occupation" | "services" | "dialogue" | "asked" | "promised" | "worth";
const FACTS: { key: FactKey; label: string; placeholder: string; long?: boolean }[] = [
  { key: "place", label: "Where", placeholder: "e.g. {town}, near the gate" },
  { key: "occupation", label: "Occupation", placeholder: "e.g. trainer, merchant" },
  { key: "faction", label: "Faction", placeholder: "e.g. Fighters Guild" },
  { key: "services", label: "Services", placeholder: "e.g. trains Alchemy" },
  { key: "dialogue", label: "Important dialogue", placeholder: "What they said that matters", long: true },
  { key: "asked", label: "Asked me to", placeholder: "What they want", long: true },
  { key: "promised", label: "I promised", placeholder: "What you said you'd do", long: true },
  { key: "worth", label: "Worth remembering", placeholder: "Items or services to come back for", long: true },
];

function getFact(p: Npc, k: FactKey): string {
  if (k === "place" || k === "faction" || k === "occupation" || k === "services") return p[k];
  return p.facts[k] ?? "";
}

async function saveFact(p: Npc, k: FactKey, v: string) {
  if (k === "place" || k === "faction" || k === "occupation" || k === "services") {
    await mutate((d) => repo.updateNpc(d, p.id, { [k]: v }));
  } else {
    const facts: NpcFacts = { ...p.facts, [k]: v };
    await mutate((d) => repo.updateNpc(d, p.id, { facts }));
  }
}

function NpcDetail({ npc }: { npc: Npc }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const [extra, setExtra] = useState<FactKey[]>([]);
  useEffect(() => setExtra([]), [npc.id]);
  const shown = FACTS.filter((f) => getFact(npc, f.key).trim() || extra.includes(f.key));
  const missing = FACTS.filter((f) => !shown.includes(f));
  return (
    <div className="detail npc-detail">
      <div className="detail-head">
        <Icon name="person" size={22} />
        <Field className="detail-title" value={npc.name} onSave={(v) => void mutate((d) => repo.updateNpc(d, npc.id, { name: v }))} />
        <Btn small kind={npc.pinned ? "primary" : "ghost"} icon="star" title={npc.pinned ? "Unpin" : "Pin"} onClick={() => void mutate((d) => repo.updateNpc(d, npc.id, { pinned: !npc.pinned }))} />
        <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteNpc(d, npc.id), "Person removed.")} />
      </div>
      <div className="facts">
        {shown.map((f) => (
          <div key={f.key} className={`fact ${f.long ? "fact-long" : ""}`}>
            <span className="fact-label">{f.label}</span>
            {f.long ? (
              <TextBlock value={getFact(npc, f.key)} rows={2} placeholder={exampleText(f.placeholder, game)} onSave={(v) => void saveFact(npc, f.key, v)} autoFocus={extra[extra.length - 1] === f.key} />
            ) : (
              <Field value={getFact(npc, f.key)} placeholder={exampleText(f.placeholder, game)} onSave={(v) => void saveFact(npc, f.key, v)} autoFocus={extra[extra.length - 1] === f.key} />
            )}
          </div>
        ))}
      </div>
      {missing.length ? (
        <div className="add-facts">
          {missing.map((f) => (
            <button key={f.key} className="chip add-chip" onClick={() => setExtra((x) => [...x, f.key])}>
              <Icon name="plus" size={12} /> {f.label}
            </button>
          ))}
        </div>
      ) : null}
      <Panel title="Observations">
        <TextBlock value={npc.notes} rows={4} placeholder={exampleText('e.g. "I found a trainer in {town}, but I couldn\'t afford the training."', game)} onSave={(v) => void mutate((d) => repo.updateNpc(d, npc.id, { notes: v }))} />
      </Panel>
      <Panel title="Connections">
        <LinkChips characterId={ch.id} self={{ type: "npc", id: npc.id }} types={["quest"]} addTypes={["quest"]} label="Quests" />
        <LinkChips characterId={ch.id} self={{ type: "npc", id: npc.id }} types={["marker", "delve"]} addTypes={["marker", "delve"]} label="Places" />
        <LinkChips characterId={ch.id} self={{ type: "npc", id: npc.id }} types={["npc"]} addTypes={["npc"]} label="Other people" createNpc />
        <LinkChips characterId={ch.id} self={{ type: "npc", id: npc.id }} types={["discovery", "note"]} addTypes={["discovery", "note"]} label="Factions, items & notes" />
      </Panel>
    </div>
  );
}

export function PeopleView() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const target = useApp((s) => s.target);
  const t = useTerm();
  const [sel, setSel] = useState<string | null>(target?.type === "npc" ? target.id ?? null : null);
  const [filter, setFilter] = useState("");
  const [byPlace, setByPlace] = useState(false);
  const { data: npcs } = useQuery((d) => repo.listNpcs(d, ch.id), [ch.id], [] as Npc[]);
  useEffect(() => {
    if (target?.type === "npc" && target.id) setSel(target.id);
  }, [target]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return npcs.filter((p) => !f || `${p.name} ${p.place} ${p.occupation} ${p.faction} ${p.services} ${p.notes} ${Object.values(p.facts).join(" ")}`.toLowerCase().includes(f));
  }, [npcs, filter]);
  const groups = useMemo(() => {
    const m = new Map<string, Npc[]>();
    for (const p of shown) {
      const k = byPlace ? p.place.split(",")[0].trim() || "Somewhere" : p.pinned ? "★ Pinned" : (p.name[0] ?? "#").toUpperCase();
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort((a, b) => (a[0].startsWith("★") ? -1 : b[0].startsWith("★") ? 1 : a[0].localeCompare(b[0])));
  }, [shown, byPlace]);
  const selected = npcs.find((p) => p.id === sel) ?? null;
  const list = (
    <div className="list-pane">
      <QuickAdd
        placeholder="Name @ place - what to remember"
        onAdd={async (text) => {
          const p = parseNpcQuick(text);
          if (!p.name) return;
          const id = await mutate((d) => repo.createNpc(d, ch.id, { name: p.name, place: p.place, notes: p.note }));
          if (id) setSel(id);
        }}
      />
      <div className="row">
        <input className="field grow" placeholder="Find a person, place, faction…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Btn small kind={byPlace ? "primary" : "ghost"} icon="pin" title="Group by place" onClick={() => setByPlace((v) => !v)} />
      </div>
      {npcs.length === 0 ? (
        <Empty icon="people" title="Nobody recorded yet">
          Type a name and press Enter. &ldquo;Old trader @ {game.examples.town} - sells alchemy gear&rdquo; fills in the place and a note in one go.
        </Empty>
      ) : null}
      {groups.map(([g, items]) => (
        <div key={g} className="list-group">
          <div className="list-group-head">{g}</div>
          {items.map((p) => (
            <button key={p.id} className={`list-item ${p.id === sel ? "on" : ""}`} onClick={() => setSel(p.id)}>
              <span className="li-title">{p.name}</span>
              <span className="li-sub">{[p.occupation, p.place].filter(Boolean).join(" · ") || truncate(p.notes, 60)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <Page title={t("people")} subtitle={`${npcs.length} recorded`}>
      <ListDetail
        id="people"
        showDetail={!!selected}
        list={list}
        detail={
          selected ? (
            <>
              <button className="back-link" onClick={() => { setSel(null); setState({ target: null }); }}>
                <Icon name="chevron" size={14} className="flip" /> Everyone
              </button>
              <NpcDetail key={selected.id} npc={selected} />
            </>
          ) : (
            <Empty icon="people" title="Choose someone">Their facts, promises and connections appear here.</Empty>
          )
        }
      />
    </Page>
  );
}
