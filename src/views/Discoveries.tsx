import { useEffect, useMemo, useState } from "react";
import { useApp, useQuery, mutate, setState, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Discovery } from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Empty, Field, TextBlock, Select, ListDetail, Source, Toggle } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { LinkChips } from "../ui/links.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { savePrefs } from "../app/prefs.ts";
import { truncate, normKey } from "../core/util.ts";
import { placeLabels } from "../core/atlas.ts";

function Detail({ d }: { d: Discovery }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  return (
    <div className="detail">
      <div className="detail-head">
        <Icon name="discoveries" size={22} />
        <Field className="detail-title" value={d.name} onSave={(v) => void mutate((db) => repo.updateDiscovery(db, d.id, { name: v }))} />
        <Select value={d.category} onChange={(v) => void mutate((db) => repo.updateDiscovery(db, d.id, { category: v }))} options={[...new Set([...game.discoveryCategories, d.category])].map((c) => ({ value: c, label: c }))} />
        <ConfirmBtn onConfirm={() => void mutate((db) => repo.deleteDiscovery(db, d.id), "Entry removed.")} />
      </div>
      <div className="detail-meta">{d.source === "sync" ? <span><Source kind="sync" /> Recorded by the game bridge when you first went there</span> : <span className="muted">Your entry</span>}</div>
      <Panel title="What you know">
        <TextBlock value={d.body} rows={6} placeholder="What you learned, in your own words" onSave={(v) => void mutate((db) => repo.updateDiscovery(db, d.id, { body: v }))} />
      </Panel>
      <Panel title="Connections">
        <LinkChips characterId={ch.id} self={{ type: "discovery", id: d.id }} addTypes={["npc", "quest", "marker", "note", "discovery"]} />
      </Panel>
    </div>
  );
}

export function DiscoveriesView() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const t = useTerm();
  const target = useApp((s) => s.target);
  const reference = useApp((s) => s.prefs.referenceMode);
  const atlas = useApp((s) => (s.atlas && s.atlas.gameId === ch.gameId ? s.atlas : null));
  const [cat, setCat] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(target?.type === "discovery" ? target.id ?? null : null);
  const [name, setName] = useState("");
  const [newCat, setNewCat] = useState(game.discoveryCategories[0]);
  const [filter, setFilter] = useState("");
  const { data: all } = useQuery((d) => repo.listDiscoveries(d, ch.id), [ch.id], [] as Discovery[]);
  useEffect(() => {
    if (target?.type === "discovery" && target.id) setSel(target.id);
  }, [target]);
  const cats = [...new Set([...game.discoveryCategories, ...all.map((d) => d.category)])];
  const shown = all.filter((d) => (!cat || d.category === cat) && (!filter.trim() || `${d.name} ${d.body}`.toLowerCase().includes(filter.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  const selected = all.find((d) => d.id === sel) ?? null;
  const known = new Set(all.map((d) => normKey(d.name)));
  const refPlaces = useMemo(() => (atlas && reference ? placeLabels(atlas.index).sort((a, b) => a.name.localeCompare(b.name)) : []), [atlas, reference]);

  const list = (
    <div className="list-pane">
      <div className="row add-discovery">
        <input className="field grow" placeholder="New entry" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={async (e) => {
          if (e.key === "Enter" && name.trim()) {
            const id = await mutate((d) => repo.addDiscovery(d, ch.id, { category: cat ?? newCat, name }));
            setName("");
            if (id) setSel(id);
          }
        }} />
        {!cat ? <Select value={newCat} onChange={setNewCat} options={game.discoveryCategories.map((c) => ({ value: c, label: c }))} /> : null}
      </div>
      <div className="cat-chips">
        <button className={`chip ${cat === null ? "on" : ""}`} onClick={() => setCat(null)}>All <span className="muted">{all.length}</span></button>
        {cats.map((c) => {
          const n = all.filter((d) => d.category === c).length;
          return (
            <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(cat === c ? null : c)}>
              {c} <span className="muted">{n}</span>
            </button>
          );
        })}
      </div>
      <input className="field" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {shown.length === 0 ? (
        <Empty icon="discoveries" title="Nothing here yet">Your encyclopedia only holds what you actually discovered or saved. It never fills itself from a wiki.</Empty>
      ) : (
        shown.map((d) => (
          <button key={d.id} className={`list-item ${d.id === sel ? "on" : ""}`} onClick={() => setSel(d.id)}>
            <span className="li-title">{d.name} {d.source === "sync" ? <Source kind="sync" /> : null}</span>
            <span className="li-sub">{d.category}{d.body ? ` · ${truncate(d.body, 60)}` : ""}</span>
          </button>
        ))
      )}
    </div>
  );

  return (
    <Page title={t("discoveries")} subtitle="My discoveries — kept apart from any external reference">
      <ListDetail
        id="discoveries"
        showDetail={!!selected}
        list={list}
        detail={
          selected ? (
            <>
              <button className="back-link" onClick={() => { setSel(null); setState({ target: null }); }}>
                <Icon name="chevron" size={14} className="flip" /> All entries
              </button>
              <Detail key={selected.id} d={selected} />
            </>
          ) : (
            <div className="reference-zone">
              <Empty icon="discoveries" title="Choose an entry">Places you visit with the bridge running appear automatically (marked SYNCED). Everything else is yours to write.</Empty>
              {game.support === "enhanced" ? (
                <Panel title={<>External reference <Source kind="game" /></>} className="reference-panel">
                  <Toggle on={reference} onChange={(v) => void savePrefs({ referenceMode: v })} label="Show reference information from my game files" />
                  {!reference ? (
                    <p className="muted small">Off by default so nothing is spoiled. When on, it lists place names defined in your installed game files &mdash; clearly separate from your own discoveries.</p>
                  ) : !atlas ? (
                    <p className="muted small">Build the world map in Settings first; the reference is read from the same files.</p>
                  ) : (
                    <ul className="ref-list">
                      {refPlaces.map((p) => (
                        <li key={p.name} className={known.has(normKey(p.name)) ? "known" : ""}>
                          {p.name}
                          {known.has(normKey(p.name)) ? <span className="muted small"> · in your discoveries</span> : (
                            <Btn small kind="ghost" icon="plus" onClick={() => void mutate((d) => repo.addDiscovery(d, ch.id, { category: "Places", name: p.name }))}>
                              Add as discovered
                            </Btn>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              ) : null}
            </div>
          )
        }
      />
    </Page>
  );
}
