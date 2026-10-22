import { useMemo, useState } from "react";
import { useApp, useQuery, mutate, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Route } from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Select, Toggle, Source, Pill, Empty } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { EntryList } from "../ui/entries.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { findRoute, gameTravelEdges, placesFromEdges, settlementOf } from "../core/atlas.ts";
import type { TravelEdge } from "../core/atlas.ts";
import { savePrefs } from "../app/prefs.ts";
import { normKey } from "../core/util.ts";

function myEdges(routes: Route[]): TravelEdge[] {
  return routes.map((r) => ({ from: r.fromPlace, to: r.toPlace, fromLabel: r.fromPlace, toLabel: r.toPlace, mode: r.mode, source: "mine" as const, notes: r.notes }));
}

export function TravelView() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const t = useTerm();
  const atlas = useApp((s) => (s.atlas && s.atlas.gameId === ch.gameId ? s.atlas : null));
  const reference = useApp((s) => s.prefs.referenceMode);
  const liveCell = useApp((s) => (["live", "limited"].includes(s.live.status.state) ? s.live.state?.cell : undefined));
  const { data: routes } = useQuery((d) => repo.listRoutes(d, ch.id), [ch.id], [] as Route[]);
  const gameEdges = useMemo(() => (atlas ? gameTravelEdges(atlas.index.data) : []), [atlas]);
  const edges = useMemo(() => [...myEdges(routes), ...(reference ? gameEdges : [])], [routes, gameEdges, reference]);
  const places = useMemo(() => placesFromEdges(edges), [edges]);
  const here = liveCell?.name ? settlementOf(liveCell.name) : "";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [nf, setNf] = useState({ from: "", to: "", mode: game.travelModes[0], notes: "", back: true });
  const fromQ = from || here;
  const route = fromQ && to ? findRoute(edges, fromQ, to) : null;
  const fromHere = here ? edges.filter((e) => normKey(e.from) === normKey(here)) : [];

  const knownKeys = new Set(routes.map((r) => `${normKey(r.fromPlace)}>${normKey(r.toPlace)}>${r.mode}`));
  const groupedGame = useMemo(() => {
    const m = new Map<string, TravelEdge[]>();
    for (const e of gameEdges) m.set(e.from, [...(m.get(e.from) ?? []), e]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [gameEdges]);

  return (
    <Page title={t("travel")} subtitle="Only routes you recorded, or that exist in your own game files">
      <datalist id="travel-places">
        {places.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="grid-panels travel-grid">
        <Panel title="Find a way" framed className="span-2">
          <div className="row">
            <input className="field" list="travel-places" placeholder={here ? `From (now: ${here})` : "From"} value={from} onChange={(e) => setFrom(e.target.value)} />
            <Icon name="arrowRight" size={18} />
            <input className="field" list="travel-places" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {fromQ && to ? (
            route === null ? (
              <p className="muted">No known connection from {fromQ} to {to}. Record routes as you discover them{game.support === "enhanced" && !reference ? ", or turn on reference mode to include the travel services listed in your game files" : ""}.</p>
            ) : route.length === 0 ? (
              <p className="muted">You are already there.</p>
            ) : (
              <ol className="route">
                {route.map((e, i) => (
                  <li key={i}>
                    <strong>{e.fromLabel}</strong> <Icon name="arrowRight" size={14} /> <strong>{e.toLabel}</strong> <Pill tone="accent">{e.mode}</Pill>
                    {e.source === "game" ? <Source kind="game" /> : <Pill>your route</Pill>}
                    {e.via ? <span className="muted small"> · {e.via}</span> : null}
                    {e.notes ? <span className="muted small"> · {e.notes}</span> : null}
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className="muted small">Costs are not shown: CODEX.EXE has no verified price data. Teleport spells and interventions follow the game&rsquo;s own rules &mdash; note how they worked for you below.</p>
          )}
        </Panel>

        {here ? (
          <Panel title={`From ${here}`}>
            {fromHere.length ? (
              <ul className="list compact-list">
                {fromHere.map((e, i) => (
                  <li key={i} className="list-row">
                    <Icon name="arrowRight" size={13} /> <span className="grow">{e.toLabel}</span> <Pill tone="accent">{e.mode}</Pill> {e.source === "game" ? <Source kind="game" /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No routes from here recorded yet.</p>
            )}
          </Panel>
        ) : null}

        <Panel title="My routes">
          <div className="route-form">
            <input className="field" list="travel-places" placeholder="From" value={nf.from} onChange={(e) => setNf({ ...nf, from: e.target.value })} />
            <input className="field" list="travel-places" placeholder="To" value={nf.to} onChange={(e) => setNf({ ...nf, to: e.target.value })} />
            <Select value={nf.mode} onChange={(v) => setNf({ ...nf, mode: v })} options={game.travelModes.map((m) => ({ value: m, label: m }))} />
            <input className="field" placeholder="Notes (optional)" value={nf.notes} onChange={(e) => setNf({ ...nf, notes: e.target.value })} />
            <Toggle on={nf.back} onChange={(v) => setNf({ ...nf, back: v })} label="Also the way back" />
            <Btn
              small
              kind="primary"
              icon="plus"
              disabled={!nf.from.trim() || !nf.to.trim()}
              onClick={async () => {
                await mutate(async (d) => {
                  await repo.addRoute(d, ch.id, { fromPlace: nf.from, toPlace: nf.to, mode: nf.mode, notes: nf.notes });
                  if (nf.back) await repo.addRoute(d, ch.id, { fromPlace: nf.to, toPlace: nf.from, mode: nf.mode, notes: nf.notes });
                });
                setNf({ ...nf, from: "", to: "", notes: "" });
              }}
            >
              Add route
            </Btn>
          </div>
          {routes.length === 0 ? (
            <p className="muted small">e.g. {game.id === "morrowind" ? "Balmora → Seyda Neen by Silt Strider" : `${game.examples.town} → ${game.examples.town2}`}. Recorded routes are used by &ldquo;Find a way&rdquo;.</p>
          ) : (
            <ul className="list compact-list">
              {routes.map((r) => (
                <li key={r.id} className="list-row">
                  <span className="grow">
                    {r.fromPlace} <Icon name="arrowRight" size={12} /> {r.toPlace} <Pill tone="accent">{r.mode}</Pill>
                    {r.notes ? <span className="muted small"> · {r.notes}</span> : null}
                  </span>
                  <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteRoute(d, r.id))} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Mark & Recall, interventions and shortcuts">
          <EntryList
            characterId={ch.id}
            scope="travel"
            kinds={[
              { id: "markrecall", label: "Mark & Recall spot", icon: "pin", check: false },
              { id: "intervention", label: "Intervention note", icon: "star", check: false },
              { id: "shortcut", label: "Shortcut / path", icon: "travel", check: false },
            ]}
            placeholder="Marked the spot outside the cave @ Ald'ruhn"
            showPlace
            emptyText="Where your Mark is set, where interventions took you, useful paths."
          />
        </Panel>

        {game.support === "enhanced" ? (
          <Panel title={<>Travel services in your game files <Source kind="game" /></>} className="span-2">
            <Toggle on={reference} onChange={(v) => void savePrefs({ referenceMode: v })} label="Reference mode (shows destinations you may not have discovered)" />
            {!atlas ? (
              <Empty icon="travel" title="No game data loaded">Build the world map from your game files in Settings to read the travel services they define.</Empty>
            ) : !reference ? (
              <p className="muted small">Hidden to keep exploration intact. {gameEdges.length} travel links were found in your load order.</p>
            ) : (
              <div className="game-routes">
                {groupedGame.map(([fromPlace, list]) => (
                  <div key={fromPlace} className="game-route-group">
                    <h4>{fromPlace}</h4>
                    <ul className="list compact-list">
                      {list.map((e, i) => {
                        const known = knownKeys.has(`${normKey(e.from)}>${normKey(e.to)}>${e.mode}`);
                        return (
                          <li key={i} className="list-row">
                            <span className="grow">
                              {e.toLabel} <Pill tone="accent">{e.mode}</Pill> <span className="muted small">{e.via}</span>
                            </span>
                            {known ? (
                              <Pill tone="ok">known</Pill>
                            ) : (
                              <Btn small kind="ghost" icon="plus" onClick={() => void mutate((d) => repo.addRoute(d, ch.id, { fromPlace: e.from, toPlace: e.to, mode: e.mode, notes: e.via ? `via ${e.via}` : "" }))}>
                                I know this
                              </Btn>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </Page>
  );
}
