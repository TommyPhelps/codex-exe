import { useEffect, useState } from "react";
import { useApp, useQuery, mutate, navigate, setState, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Delve, DelveStatus } from "../db/repo.ts";
import { DELVE_STATUSES } from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Empty, Field, TextBlock, QuickAdd, Select, ListDetail, Pill, Source } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { EntryList } from "../ui/entries.tsx";
import type { KindDef } from "../ui/entries.tsx";
import { LinkChips } from "../ui/links.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { exampleText } from "../core/games.ts";
import { parseAtPlace } from "../core/quick.ts";
import { cellLabel } from "../core/protocol.ts";
import { normKey, truncate } from "../core/util.ts";

export const DELVE_KINDS: KindDef[] = [
  { id: "entrance", label: "Entrance / exit", icon: "door" },
  { id: "locked", label: "Locked door", icon: "lock" },
  { id: "key", label: "Key needed", icon: "key" },
  { id: "unexplored", label: "Unexplored passage", icon: "arrowRight" },
  { id: "danger", label: "Dangerous enemy", icon: "skull" },
  { id: "hidden", label: "Hidden room I found", icon: "eye" },
  { id: "loot", label: "Loot left behind", icon: "chest" },
  { id: "reminder", label: "Return-later reminder", icon: "clock" },
  { id: "room", label: "Room note", icon: "rect" },
];

const STATUS_LABEL: Record<DelveStatus, string> = { unexplored: "Not explored yet", exploring: "Exploring", left: "Left unfinished", cleared: "Cleared" };
const STATUS_TONE: Record<DelveStatus, "plain" | "accent" | "warn" | "ok"> = { unexplored: "plain", exploring: "accent", left: "warn", cleared: "ok" };

function openMap(characterId: string, mapId: string) {
  try {
    localStorage.setItem(`codex.map.${characterId}`, mapId);
  } catch {
    /* ignore */
  }
  navigate({ section: "map" });
}

function DelveDetail({ delve }: { delve: Delve }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const liveCell = useApp((s) => (["live", "limited"].includes(s.live.status.state) ? s.live.state?.cell : undefined));
  const { data: maps } = useQuery((d) => repo.listMaps(d, ch.id), [ch.id], [] as repo.MapRec[]);
  const map = maps.find((m) => m.id === delve.mapId) ?? null;
  const here = liveCell && !liveCell.exterior && delve.place && normKey(liveCell.name).startsWith(normKey(delve.place));
  return (
    <div className="detail delve-detail">
      <div className="detail-head">
        <Icon name="delves" size={22} />
        <Field className="detail-title" value={delve.name} onSave={(v) => void mutate((d) => repo.updateDelve(d, delve.id, { name: v }))} />
        <Select value={delve.status} onChange={(v) => void mutate((d) => repo.updateDelve(d, delve.id, { status: v }))} options={DELVE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteDelve(d, delve.id), "Dungeon removed.")} />
      </div>
      <div className="row">
        <Field label="Where" value={delve.place} placeholder={exampleText("e.g. a cave north of {town} / the interior's name", game)} onSave={(v) => void mutate((d) => repo.updateDelve(d, delve.id, { place: v }))} />
        {liveCell && !liveCell.exterior && !here ? (
          <Btn small icon="pin" onClick={() => void mutate((d) => repo.updateDelve(d, delve.id, { place: liveCell.name, status: delve.status === "unexplored" ? "exploring" : delve.status }))}>
            Use current location ({cellLabel(liveCell)})
          </Btn>
        ) : null}
        {here ? <span><Source kind="live" /> You are here</span> : null}
      </div>
      <Panel title={delve.status === "left" ? "Why I left / what I need to come back" : "Why I stopped / what I need"} className="next-action">
        <TextBlock value={delve.reason} rows={2} hand placeholder="e.g. Needed better equipment — the lower level had a dangerous guardian." onSave={(v) => void mutate((d) => repo.updateDelve(d, delve.id, { reason: v }))} />
      </Panel>
      <div className="quest-grid">
        <Panel title="Notebook" className="span-2">
          <EntryList characterId={ch.id} scope="delve" parentId={delve.id} kinds={DELVE_KINDS} placeholder="Locked iron door, north corridor…" emptyText="Entrances, locked doors, keys, unexplored passages, enemies, hidden rooms you found, loot you left." />
        </Panel>
        <Panel title="Map of this place">
          {map ? (
            <div className="row">
              <span>
                <Icon name={map.kind === "sketch" ? "pen" : "image"} size={15} /> {map.name}
              </span>
              <Btn small icon="map" onClick={() => openMap(ch.id, map.id)}>Open</Btn>
              <Btn small kind="ghost" onClick={() => void mutate((d) => repo.updateDelve(d, delve.id, { mapId: null }))}>Detach</Btn>
            </div>
          ) : (
            <>
              <p className="muted small">CODEX.EXE does not know dungeon layouts. Draw your own rough sketch, or attach a map image you imported.</p>
              <div className="row">
                <Btn
                  small
                  icon="pen"
                  onClick={async () => {
                    const id = await mutate((d) => repo.createMap(d, ch.id, ch.gameId, "sketch", `${delve.name} (sketch)`));
                    if (id) {
                      await mutate((d) => repo.updateDelve(d, delve.id, { mapId: id }));
                      openMap(ch.id, id);
                    }
                  }}
                >
                  Start a sketch
                </Btn>
                {maps.length ? (
                  <Select
                    value=""
                    onChange={(v) => v && void mutate((d) => repo.updateDelve(d, delve.id, { mapId: v }))}
                    options={[{ value: "", label: "Attach an existing map…" }, ...maps.map((m) => ({ value: m.id, label: m.name }))]}
                  />
                ) : null}
              </div>
            </>
          )}
        </Panel>
        <Panel title="Connections">
          <LinkChips characterId={ch.id} self={{ type: "delve", id: delve.id }} addTypes={["quest", "marker", "npc", "note"]} createNpc />
        </Panel>
        <Panel title="Notes" className="span-2">
          <TextBlock value={delve.notes} rows={4} placeholder="Anything else about this place" onSave={(v) => void mutate((d) => repo.updateDelve(d, delve.id, { notes: v }))} />
        </Panel>
      </div>
    </div>
  );
}

export function DelvesView() {
  const ch = useApp(activeCharacter)!;
  const target = useApp((s) => s.target);
  const t = useTerm();
  const [sel, setSel] = useState<string | null>(target?.type === "delve" ? target.id ?? null : null);
  const { data: delves } = useQuery((d) => repo.listDelves(d, ch.id), [ch.id], [] as Delve[]);
  useEffect(() => {
    if (target?.type === "delve" && target.id) setSel(target.id);
  }, [target]);
  const selected = delves.find((d) => d.id === sel) ?? null;
  const list = (
    <div className="list-pane">
      <QuickAdd
        placeholder="Dungeon or cave name @ where"
        onAdd={async (text) => {
          const p = parseAtPlace(text);
          const id = await mutate((d) => repo.createDelve(d, ch.id, p.title, p.place));
          if (id) setSel(id);
        }}
      />
      {delves.length === 0 ? (
        <Empty icon="delves" title="No dungeons noted">
          Keep track of caves and ruins: what you found, what is locked, what you left behind and why you turned back.
        </Empty>
      ) : null}
      {delves.map((d) => (
        <button key={d.id} className={`list-item ${d.id === sel ? "on" : ""}`} onClick={() => setSel(d.id)}>
          <span className="li-title">{d.name}</span>
          <span className="li-sub">
            <Pill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Pill> {d.reason ? truncate(d.reason, 60) : d.place}
          </span>
        </button>
      ))}
    </div>
  );
  return (
    <Page title={t("delves")} subtitle={`${delves.filter((d) => d.status === "left" || d.status === "exploring").length} unfinished`}>
      <ListDetail
        id="delves"
        showDetail={!!selected}
        list={list}
        detail={
          selected ? (
            <>
              <button className="back-link" onClick={() => { setSel(null); setState({ target: null }); }}>
                <Icon name="chevron" size={14} className="flip" /> All dungeons
              </button>
              <DelveDetail key={selected.id} delve={selected} />
            </>
          ) : (
            <Empty icon="delves" title="Choose a dungeon">Its notebook and sketch appear here.</Empty>
          )
        }
      />
    </Page>
  );
}
