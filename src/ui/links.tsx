// Link chips between records (quest <-> person <-> marker <-> note ...).
import { useState } from "react";
import { useQuery, mutate, navigate, db } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { LinkType } from "../db/repo.ts";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { Btn, Select } from "./bits.tsx";

const TYPE_ICON: Record<string, IconName> = { quest: "quests", npc: "person", marker: "pin", note: "journal", delve: "delves", entry: "check", discovery: "discoveries" };

export function goTo(type: LinkType, id: string, extra?: string): void {
  switch (type) {
    case "quest":
      return navigate({ section: "quests", type: "quest", id });
    case "npc":
      return navigate({ section: "people", type: "npc", id });
    case "marker":
      return navigate({ section: "map", type: "marker", id, extra });
    case "note":
      return navigate({ section: "journal", type: "note", id });
    case "delve":
      return navigate({ section: "delves", type: "delve", id });
    case "discovery":
      return navigate({ section: "discoveries", type: "discovery", id });
    default:
      return;
  }
}

async function options(characterId: string, type: LinkType): Promise<{ value: string; label: string }[]> {
  const d = db();
  switch (type) {
    case "npc":
      return (await repo.listNpcs(d, characterId)).map((x) => ({ value: x.id, label: x.name }));
    case "quest":
      return (await repo.listQuests(d, characterId)).map((x) => ({ value: x.id, label: x.title }));
    case "marker":
      return (await repo.listMarkers(d, characterId)).map((x) => ({ value: x.id, label: x.label || "(unnamed marker)" }));
    case "delve":
      return (await repo.listDelves(d, characterId)).map((x) => ({ value: x.id, label: x.name }));
    case "discovery":
      return (await repo.listDiscoveries(d, characterId)).map((x) => ({ value: x.id, label: `${x.name} (${x.category})` }));
    case "note":
      return (await repo.listNotes(d, characterId, { limit: 300 })).map((x) => ({ value: x.id, label: x.title || x.body.slice(0, 60) }));
    default:
      return [];
  }
}

/**
 * Shows everything linked to `self` (optionally only some types) and lets the
 * player add a link to an existing record, or create a person by name.
 */
export function LinkChips({
  characterId,
  self,
  types,
  addTypes,
  label,
  createNpc,
}: {
  characterId: string;
  self: { type: LinkType; id: string };
  types?: LinkType[];
  addTypes: LinkType[];
  label?: string;
  createNpc?: boolean;
}) {
  const { data } = useQuery(
    async (d) => {
      const refs = await repo.linksOf(d, self.type, self.id);
      const filtered = types ? refs.filter((r) => types.includes(r.type)) : refs;
      return repo.describeRefs(d, filtered);
    },
    [self.type, self.id, (types ?? []).join(",")],
    [] as { type: LinkType; id: string; name: string; label: string }[],
  );
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<LinkType>(addTypes[0]);
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([]);
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [relLabel, setRelLabel] = useState("");
  const begin = async (t: LinkType) => {
    setAddType(t);
    const o = (await options(characterId, t)).filter((x) => !(t === self.type && x.value === self.id));
    setOpts(o);
    setChoice(o[0]?.value ?? "");
    setAdding(true);
  };
  return (
    <div className="links">
      {label ? <div className="links-label">{label}</div> : null}
      <div className="chips">
        {data.map((r) => (
          <span key={`${r.type}-${r.id}`} className="chip link-chip">
            <button className="chip-main" onClick={() => goTo(r.type, r.id)} title={`Open ${r.type}`}>
              <Icon name={TYPE_ICON[r.type] ?? "link"} size={13} /> {r.name}
              {r.label ? <span className="muted"> · {r.label}</span> : null}
            </button>
            <button className="chip-x" title="Remove link" onClick={() => void mutate((d) => repo.unlink(d, self, { type: r.type, id: r.id }))}>
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        {!adding ? (
          <Btn small kind="ghost" icon="link" onClick={() => void begin(addTypes[0])}>
            Link
          </Btn>
        ) : null}
      </div>
      {adding ? (
        <div className="link-add">
          {addTypes.length > 1 ? (
            <Select
              value={addType}
              onChange={(v) => void begin(v as LinkType)}
              options={addTypes.map((t) => ({ value: t, label: t === "npc" ? "Person" : t === "delve" ? "Dungeon" : t.charAt(0).toUpperCase() + t.slice(1) }))}
            />
          ) : null}
          {opts.length ? <Select value={choice} onChange={setChoice} options={opts} /> : <span className="muted small">None recorded yet.</span>}
          {self.type === "npc" && addType === "npc" ? <input className="field small" placeholder="relationship (optional)" value={relLabel} onChange={(e) => setRelLabel(e.target.value)} /> : null}
          <Btn
            small
            kind="primary"
            disabled={!choice}
            onClick={async () => {
              await mutate((d) => repo.link(d, characterId, self, { type: addType, id: choice }, relLabel.trim()));
              setAdding(false);
              setRelLabel("");
            }}
          >
            Add
          </Btn>
          {createNpc && addType === "npc" ? (
            <span className="inline-group">
              <input className="field small" placeholder="or new person's name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Btn
                small
                disabled={!newName.trim()}
                onClick={async () => {
                  const id = await mutate((d) => repo.createNpc(d, characterId, { name: newName }));
                  if (id) await mutate((d) => repo.link(d, characterId, self, { type: "npc", id }));
                  setNewName("");
                  setAdding(false);
                }}
              >
                Create &amp; link
              </Btn>
            </span>
          ) : null}
          <Btn small kind="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
