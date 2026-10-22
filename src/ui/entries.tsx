// Checklist-style lists used across quests, dungeons, the ledger and the character sheet.
import { useState } from "react";
import { useQuery, mutate } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Entry, EntryScope } from "../db/repo.ts";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { Btn, ConfirmBtn, Field, QuickAdd, Select } from "./bits.tsx";
import { parseAtPlace } from "../core/quick.ts";

export interface KindDef {
  id: string;
  label: string;
  icon?: IconName;
  /** Kinds that are checklists show a tick box. */
  check?: boolean;
}

export function EntryRow({ e, kinds, showPlace }: { e: Entry; kinds: KindDef[]; showPlace?: boolean }) {
  const [open, setOpen] = useState(false);
  const k = kinds.find((x) => x.id === e.kind);
  return (
    <li className={`entry ${e.done ? "done" : ""}`}>
      <div className="entry-main">
        {k?.check !== false ? (
          <button className={`check-box ${e.done ? "on" : ""}`} onClick={() => void mutate((d) => repo.updateEntry(d, e.id, { done: !e.done }))} title={e.done ? "Mark not done" : "Mark done"} aria-pressed={e.done}>
            {e.done ? <Icon name="check" size={13} /> : null}
          </button>
        ) : (
          <Icon name={k?.icon ?? "dot"} size={14} />
        )}
        {kinds.length > 1 && k ? (
          <span className={`kind kind-${e.kind}`} title={k.label}>
            <Icon name={k.icon ?? "dot"} size={13} />
          </span>
        ) : null}
        <Field className="entry-title" value={e.title} onSave={(v) => void mutate((d) => repo.updateEntry(d, e.id, { title: v }))} />
        {showPlace ? <Field className="entry-place" value={e.place} placeholder="place" onSave={(v) => void mutate((d) => repo.updateEntry(d, e.id, { place: v }))} /> : null}
        <Btn small kind="ghost" icon={open ? "close" : "edit"} title={open ? "Close details" : "Details"} onClick={() => setOpen((o) => !o)} />
        <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteEntry(d, e.id))} />
      </div>
      {e.body && !open ? <div className="entry-body muted">{e.body}</div> : null}
      {open ? (
        <div className="entry-detail">
          {kinds.length > 1 ? <Select value={e.kind} onChange={(v) => void mutate((d) => repo.updateEntry(d, e.id, { kind: v }))} options={kinds.map((x) => ({ value: x.id, label: x.label }))} /> : null}
          <textarea className="textblock" rows={3} defaultValue={e.body} placeholder="Details" onBlur={(ev) => ev.target.value !== e.body && void mutate((d) => repo.updateEntry(d, e.id, { body: ev.target.value }))} />
        </div>
      ) : null}
    </li>
  );
}

export function EntryList({
  characterId,
  scope,
  parentId = null,
  kinds,
  only,
  placeholder,
  showPlace,
  emptyText,
}: {
  characterId: string;
  scope: EntryScope;
  parentId?: string | null;
  kinds: KindDef[];
  /** Show only these kinds (and add new items as the first of them). */
  only?: string[];
  placeholder: string;
  showPlace?: boolean;
  emptyText?: string;
}) {
  const { data } = useQuery((d) => repo.listEntries(d, characterId, scope, parentId), [characterId, scope, parentId], [] as Entry[]);
  const visible = only ? data.filter((e) => only.includes(e.kind)) : data;
  const choices = only ? kinds.filter((k) => only.includes(k.id)) : kinds;
  const [kind, setKind] = useState(choices[0]?.id ?? "note");
  return (
    <div className="entry-list">
      {visible.length === 0 && emptyText ? <p className="muted small">{emptyText}</p> : null}
      <ul>
        {visible.map((e) => (
          <EntryRow key={e.id} e={e} kinds={kinds} showPlace={showPlace} />
        ))}
      </ul>
      <div className="row">
        {choices.length > 1 ? <Select value={kind} onChange={setKind} options={choices.map((k) => ({ value: k.id, label: k.label }))} /> : null}
        <div className="grow">
          <QuickAdd
            placeholder={placeholder}
            hint={showPlace ? "@ place" : undefined}
            onAdd={async (text) => {
              const p = showPlace ? parseAtPlace(text) : { title: text, place: "" };
              await mutate((d) => repo.addEntry(d, characterId, { scope, parentId, kind, title: p.title, place: p.place }));
            }}
          />
        </div>
      </div>
    </div>
  );
}
