import { useApp, mutate, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { CharacterSheet } from "../db/repo.ts";
import { Page, Panel, Field, TextBlock, Source, Pill, Tabs } from "../ui/bits.tsx";
import { EntryList } from "../ui/entries.tsx";
import type { KindDef } from "../ui/entries.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { exampleText } from "../core/games.ts";
import type { LiveCharacter, LiveStat } from "../core/protocol.ts";
import { relativeTime } from "../core/util.ts";
import { useState } from "react";

const CHAR_KINDS: KindDef[] = [
  { id: "goal", label: "Goal", icon: "star" },
  { id: "faction", label: "Faction", icon: "people", check: false },
  { id: "spell", label: "Spell idea", icon: "discoveries", check: false },
  { id: "alchemy", label: "Alchemy", icon: "flask", check: false },
  { id: "enchant", label: "Enchantment plan", icon: "star" },
  { id: "wishlist", label: "Equipment wish", icon: "chest" },
  { id: "trainer", label: "Trainer to revisit", icon: "sword" },
  { id: "resist", label: "Resistance / weakness", icon: "character", check: false },
  { id: "milestone", label: "Milestone", icon: "check" },
];

function cap(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function liveValue(lc: LiveCharacter | undefined, field: string): string | null {
  if (!lc) return null;
  switch (field.toLowerCase()) {
    case "race":
      return lc.race ?? null;
    case "class":
      return lc.class ?? null;
    case "birthsign":
      return lc.birthsign ?? null;
    case "level":
      return lc.level !== undefined ? String(lc.level) : null;
    default:
      return null;
  }
}

function findStat(map: Record<string, LiveStat> | undefined, name: string): LiveStat | null {
  if (!map) return null;
  const k = Object.keys(map).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? map[k] : null;
}

function StatTable({ names, live, manual, onManual, majors, minors, onToggleMajor, liveLabel }: {
  names: string[];
  live?: Record<string, LiveStat>;
  manual: Record<string, string>;
  onManual: (name: string, v: string) => void;
  majors?: string[];
  minors?: string[];
  onToggleMajor?: (name: string) => void;
  liveLabel: string;
}) {
  return (
    <table className="stat-table">
      <thead>
        <tr>
          <th>Name</th>
          {live ? <th>{liveLabel}</th> : null}
          <th>My notes</th>
          {onToggleMajor ? <th title="Major / minor skill">Type</th> : null}
        </tr>
      </thead>
      <tbody>
        {names.map((n) => {
          const s = findStat(live, n);
          const major = majors?.includes(n);
          const minor = minors?.includes(n);
          return (
            <tr key={n} className={major ? "major" : minor ? "minor" : ""}>
              <td>{n}</td>
              {live ? <td className="num">{s ? (s.current !== s.base ? `${s.current} (${s.base})` : s.base) : "—"}</td> : null}
              <td>
                <Field className="small" value={manual[n] ?? ""} placeholder={live ? "" : "value"} onSave={(v) => onManual(n, v)} />
              </td>
              {onToggleMajor ? (
                <td>
                  <button className={`chip tiny ${major ? "on" : minor ? "half" : ""}`} onClick={() => onToggleMajor(n)} title="Click to cycle: none, major, minor">
                    {major ? "major" : minor ? "minor" : "·"}
                  </button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CharacterView() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const t = useTerm();
  const fresh = useApp((s) => ["live", "limited"].includes(s.live.status.state));
  const liveNow = useApp((s) => s.live.state?.character);
  const saved = ch.live as { character?: LiveCharacter; receivedAt?: string };
  const lc = fresh && liveNow ? liveNow : saved.character;
  const isLive = !!(fresh && liveNow);
  const sheet = ch.sheet;
  const [tab, setTab] = useState<"sheet" | "plans" | "lists">("sheet");
  const save = (patch: Partial<CharacterSheet>) => void mutate((d) => repo.updateCharacter(d, ch.id, { sheet: { ...ch.sheet, ...patch } }));
  const cycle = (n: string) => {
    const majors = sheet.majorSkills ?? [];
    const minors = sheet.minorSkills ?? [];
    if (majors.includes(n)) save({ majorSkills: majors.filter((x) => x !== n), minorSkills: [...minors, n] });
    else if (minors.includes(n)) save({ minorSkills: minors.filter((x) => x !== n) });
    else save({ majorSkills: [...majors, n] });
  };
  const sourceNote = lc ? (isLive ? <Source kind="live" /> : <span className="muted small">last reported by the game {saved.receivedAt ? relativeTime(saved.receivedAt) : ""}</span>) : null;
  const liveLabel = isLive ? "Live" : "Last report";

  return (
    <Page title={t("character")} subtitle={<>{ch.name} {sourceNote}</>}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "sheet", label: "Sheet" },
          { id: "plans", label: "Build & roleplay" },
          { id: "lists", label: "Notebooks" },
        ]}
      />
      {tab === "sheet" ? (
        <div className="grid-panels char-grid">
          <Panel title="Profile" framed>
            <Field label="Name" value={ch.name} onSave={(v) => void mutate((d) => repo.updateCharacter(d, ch.id, { name: v }))} />
            {game.character.fields.map((f) => {
              const lv = liveValue(lc, f);
              return (
                <div key={f} className="field-row">
                  <span className="field-label">{f}</span>
                  {lv ? (
                    <span className="live-val">
                      {lv} {isLive ? <Source kind="live" /> : <Pill>last report</Pill>}
                    </span>
                  ) : (
                    <Field value={sheet.fields?.[f] ?? ""} onSave={(v) => save({ fields: { ...(sheet.fields ?? {}), [f]: v } })} placeholder="—" />
                  )}
                </div>
              );
            })}
            {lc?.gold !== undefined ? (
              <div className="field-row"><span className="field-label">Gold</span><span className="live-val">{lc.gold} {isLive ? <Source kind="live" /> : null}</span></div>
            ) : null}
            {!lc ? <p className="muted small">With the Morrowind bridge, race, class, level, attributes and skills fill in from the game (marked LIVE). Your own notes are kept separately.</p> : null}
          </Panel>
          {lc?.health || lc?.magicka || lc?.fatigue ? (
            <Panel title={<>Condition {sourceNote}</>}>
              {(["health", "magicka", "fatigue"] as const).map((k) => {
                const s = lc?.[k];
                if (!s) return null;
                const pct = s.base > 0 ? Math.max(0, Math.min(100, (s.current / s.base) * 100)) : 0;
                return (
                  <div key={k} className={`bar bar-${k}`}>
                    <span className="bar-label">{cap(k)}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%` }} /></span>
                    <span className="bar-num">{Math.round(s.current)}/{Math.round(s.base)}</span>
                  </div>
                );
              })}
              {lc?.spell ? <p><span className="muted">Selected spell:</span> {lc.spell}</p> : null}
              {lc?.equipped?.length ? <p><span className="muted">Equipped:</span> {lc.equipped.join(", ")}</p> : null}
              {lc?.effects?.length ? <p><span className="muted">Active effects:</span> {[...new Set(lc.effects)].join(", ")}</p> : null}
            </Panel>
          ) : null}
          {game.character.attributes.length ? (
            <Panel title={game.character.attributeLabel}>
              <StatTable names={game.character.attributes} live={lc?.attributes} liveLabel={liveLabel} manual={sheet.attributes ?? {}} onManual={(n, v) => save({ attributes: { ...(sheet.attributes ?? {}), [n]: v } })} />
            </Panel>
          ) : null}
          {game.character.skills.length ? (
            <Panel title={game.character.skillLabel} className="span-2">
              <StatTable
                names={game.character.skills}
                live={lc?.skills}
                liveLabel={liveLabel}
                manual={sheet.skills ?? {}}
                onManual={(n, v) => save({ skills: { ...(sheet.skills ?? {}), [n]: v } })}
                majors={sheet.majorSkills}
                minors={sheet.minorSkills}
                onToggleMajor={game.id === "morrowind" || game.id === "oblivion" || game.id === "daggerfall" ? cycle : undefined}
              />
            </Panel>
          ) : null}
          <Panel title="Other stats">
            {(sheet.custom ?? []).map((c, i) => (
              <div key={i} className="row">
                <Field value={c.label} placeholder="label" onSave={(v) => save({ custom: (sheet.custom ?? []).map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
                <Field value={c.value} placeholder="value" onSave={(v) => save({ custom: (sheet.custom ?? []).map((x, j) => (j === i ? { ...x, value: v } : x)) })} />
              </div>
            ))}
            <button className="chip add-chip" onClick={() => save({ custom: [...(sheet.custom ?? []), { label: "", value: "" }] })}>+ Add a stat</button>
          </Panel>
        </div>
      ) : tab === "plans" ? (
        <div className="grid-panels">
          <Panel title="Build notes" className="span-2">
            <TextBlock value={sheet.build ?? ""} rows={6} placeholder="How you want this character to play. Nobody here will tell you it's wrong." onSave={(v) => save({ build: v })} />
          </Panel>
          <Panel title="Future priorities">
            <TextBlock value={sheet.priorities ?? ""} rows={5} placeholder="Skills to raise next, gear to find…" onSave={(v) => save({ priorities: v })} />
          </Panel>
          <Panel title="Roleplay, background & self-imposed rules">
            <TextBlock value={sheet.roleplay ?? ""} rows={5} hand placeholder="Never steal from temples. Only travel on foot…" onSave={(v) => save({ roleplay: v })} />
          </Panel>
          <Panel title="Goals" className="span-2">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["goal"]} placeholder={exampleText('e.g. "{goal}"', game)} emptyText="Long-term goals, tracked loosely — tick them off only if you want to." />
          </Panel>
          <Panel title="Milestones">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["milestone"]} placeholder="First daedric weapon" />
          </Panel>
          <Panel title="Resistances & weaknesses">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["resist"]} placeholder="Weak to fire (75%)" />
          </Panel>
        </div>
      ) : (
        <div className="grid-panels">
          <Panel title="Faction notebook">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["faction"]} placeholder="Mages Guild — Apprentice; need Alteration 30" emptyText="Ranks, requirements, objectives. Use details for more." />
          </Panel>
          <Panel title="Spellbook ideas">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["spell"]} placeholder="Levitate + Restore Fatigue combo" />
          </Panel>
          <Panel title="Alchemy notebook">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["alchemy"]} placeholder="Ingredient — effects I confirmed" emptyText="Only effects you confirmed yourself." />
          </Panel>
          <Panel title="Enchantment plans">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["enchant"]} placeholder="Ring of constant feather" />
          </Panel>
          <Panel title="Equipment wishlist">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["wishlist"]} placeholder="Better boots" showPlace />
          </Panel>
          <Panel title="Trainers to revisit">
            <EntryList characterId={ch.id} scope="char" kinds={CHAR_KINDS} only={["trainer"]} placeholder="Marksman trainer @ Ald'ruhn" showPlace />
          </Panel>
        </div>
      )}
    </Page>
  );
}
