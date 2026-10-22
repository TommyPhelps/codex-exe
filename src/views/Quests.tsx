import { useEffect, useMemo, useState } from "react";
import { useApp, useQuery, mutate, setState, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Quest, QuestStatus, QuestLogEntry } from "../db/repo.ts";
import { QUEST_STATUSES } from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Empty, Field, TextBlock, QuickAdd, Select, ListDetail, Source, Pill, Markdown } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { EntryList } from "../ui/entries.tsx";
import type { KindDef } from "../ui/entries.tsx";
import { LinkChips } from "../ui/links.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { exampleText } from "../core/games.ts";
import { truncate, relativeTime } from "../core/util.ts";
import * as native from "../platform/native.ts";

const CLUE_KINDS: KindDef[] = [
  { id: "clue", label: "Clue", icon: "eye" },
  { id: "question", label: "Unanswered question", icon: "hint" },
  { id: "item", label: "Item needed", icon: "chest" },
  { id: "destination", label: "Known destination", icon: "pin" },
];

const STATUS_LABEL: Record<QuestStatus, string> = { active: "Active", paused: "Paused", completed: "Completed", failed: "Failed", abandoned: "Abandoned" };

/** Where a full walkthrough can be looked up - opened only on explicit request. */
function walkthroughUrl(gameId: string, questTitle: string): string {
  const q = encodeURIComponent(questTitle);
  const tes: Record<string, string> = { morrowind: "Morrowind", daggerfall: "Daggerfall", oblivion: "Oblivion", skyrim: "Skyrim" };
  if (tes[gameId]) return `https://en.uesp.net/w/index.php?search=${encodeURIComponent(`${tes[gameId]}: ${questTitle}`)}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(gameId === "falloutnv" ? "Fallout New Vegas" : gameId)}+${q}+quest`;
}

function HintLadder({ quest, log }: { quest: Quest; log: QuestLogEntry[] }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const [step, setStep] = useState(0);
  const [armed, setArmed] = useState(false);
  const { data: entries } = useQuery((d) => repo.listEntries(d, ch.id, "quest", quest.id), [quest.id], [] as repo.Entry[]);
  useEffect(() => {
    setStep(0);
    setArmed(false);
  }, [quest.id]);
  const clues = entries.filter((e) => e.kind === "clue" && !e.done);
  const questions = entries.filter((e) => e.kind === "question" && !e.done);
  const latest = [...log].reverse().find((l) => l.text);
  const steps = [
    {
      title: "1 · Your own notes",
      body: quest.notes.trim() || quest.lastKnown.trim() ? <Markdown text={[quest.lastKnown, quest.notes].filter((x) => x.trim()).join("\n\n")} /> : <p className="muted">You have not written anything for this quest yet.</p>,
    },
    {
      title: "2 · The clues you collected",
      body:
        clues.length || questions.length ? (
          <ul className="list compact-list">
            {clues.map((c) => (
              <li key={c.id}>• {c.title}{c.place ? <span className="muted"> — {c.place}</span> : null}</li>
            ))}
            {questions.map((c) => (
              <li key={c.id}>? {c.title}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No open clues or questions recorded.</p>
        ),
    },
    {
      title: "3 · People and places you linked",
      body: <LinkChips characterId={ch.id} self={{ type: "quest", id: quest.id }} types={["npc", "marker"]} addTypes={["npc", "marker"]} />,
    },
    {
      title: "4 · What the game journal says",
      body: latest ? (
        <blockquote className="game-text">
          {latest.text} <Source kind="sync" />
        </blockquote>
      ) : (
        <p className="muted">{quest.source === "sync" ? "The bridge has not sent journal text for this quest." : "This quest is tracked manually, so there is no game journal text."}</p>
      ),
    },
  ];
  return (
    <Panel title={<><Icon name="hint" size={16} /> Need a nudge?</>} className="hint-ladder">
      <p className="muted small">
        CODEX.EXE has no hint database and never invents solutions. These steps only show what you recorded and what the game itself wrote, one step at a time. A full walkthrough opens in your browser only if you ask.
      </p>
      {steps.slice(0, step).map((s, i) => (
        <div key={i} className="hint-step">
          <div className="hint-title">{s.title}</div>
          {s.body}
        </div>
      ))}
      <div className="row">
        {step < steps.length ? (
          <Btn small icon="chevron" onClick={() => setStep(step + 1)}>
            {step === 0 ? "Show my notes" : "Next step"}
          </Btn>
        ) : (
          <Btn
            small
            kind={armed ? "danger" : "normal"}
            icon="export"
            onClick={() => {
              if (!armed) return setArmed(true);
              void native.openExternal(walkthroughUrl(game.id, quest.title)).catch(() => {});
              setArmed(false);
            }}
          >
            {armed ? "Spoilers ahead — click again to open" : "5 · Look up a full walkthrough"}
          </Btn>
        )}
        {step > 0 ? (
          <Btn small kind="ghost" onClick={() => { setStep(0); setArmed(false); }}>
            Hide
          </Btn>
        ) : null}
      </div>
    </Panel>
  );
}

function QuestDetail({ quest }: { quest: Quest }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const { data: log } = useQuery((d) => repo.questLog(d, quest.id), [quest.id], [] as QuestLogEntry[]);
  return (
    <div className="detail quest-detail">
      <div className="detail-head">
        <Field className="detail-title" value={quest.title} onSave={(v) => void mutate((d) => repo.updateQuest(d, quest.id, { title: v }))} />
        <Select value={quest.status} onChange={(v) => void mutate((d) => repo.updateQuest(d, quest.id, { status: v }))} options={QUEST_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <Btn small kind={quest.pinned ? "primary" : "ghost"} icon="star" title={quest.pinned ? "Unpin" : "Pin"} onClick={() => void mutate((d) => repo.updateQuest(d, quest.id, { pinned: !quest.pinned }))} />
        <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteQuest(d, quest.id), "Quest deleted.")} />
      </div>
      <div className="detail-meta">
        {quest.source === "sync" ? (
          <span>
            <Source kind="sync" /> From the game journal{quest.gameQuestId ? <span className="muted"> · id {quest.gameQuestId}</span> : null}
            {quest.stage !== null ? <span className="muted"> · stage {quest.stage}</span> : null}
          </span>
        ) : (
          <span className="muted">Tracked by you · started {relativeTime(quest.createdAt)}</span>
        )}
      </div>

      <div className="quest-grid">
        <Panel title="Last known information" className="span-2">
          <TextBlock value={quest.lastKnown} rows={3} placeholder={exampleText('e.g. "Someone in {town} told me to look near the river."', game)} onSave={(v) => void mutate((d) => repo.updateQuest(d, quest.id, { lastKnown: v }))} />
        </Panel>
        <Panel title="Next possible action" className="span-2 next-action">
          <TextBlock value={quest.nextAction} rows={2} hand placeholder="What do you want to try next?" onSave={(v) => void mutate((d) => repo.updateQuest(d, quest.id, { nextAction: v }))} />
        </Panel>
        <Panel title="Clues">
          <EntryList characterId={ch.id} scope="quest" parentId={quest.id} kinds={CLUE_KINDS} only={["clue", "destination"]} placeholder="Add a clue (@ place)" showPlace emptyText="Nothing yet." />
        </Panel>
        <Panel title="Unanswered questions">
          <EntryList characterId={ch.id} scope="quest" parentId={quest.id} kinds={CLUE_KINDS} only={["question"]} placeholder="What don't you know yet?" emptyText="No open questions." />
        </Panel>
        <Panel title="Items needed">
          <EntryList characterId={ch.id} scope="quest" parentId={quest.id} kinds={CLUE_KINDS} only={["item"]} placeholder="Add an item" emptyText="None recorded." />
        </Panel>
        <Panel title="People & places">
          <LinkChips characterId={ch.id} self={{ type: "quest", id: quest.id }} addTypes={["npc", "marker", "delve", "note"]} createNpc />
        </Panel>
        <Panel title="My notes" className="span-2">
          <TextBlock value={quest.notes} rows={5} placeholder={'e.g. "I searched the eastern bank but haven\'t checked the buildings."'} onSave={(v) => void mutate((d) => repo.updateQuest(d, quest.id, { notes: v }))} />
        </Panel>
        {log.length ? (
          <Panel title={<>Game journal <Source kind="sync" /></>} className="span-2">
            <ol className="game-log">
              {log.map((l) => (
                <li key={l.id}>
                  <span className="muted small">stage {l.stage}{l.gameDate ? ` · ${l.gameDate}` : ""}{l.finished ? " · finished" : ""}</span>
                  {l.text ? <blockquote className="game-text">{l.text}</blockquote> : <span className="muted"> (no text sent)</span>}
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}
        <div className="span-2">
          <HintLadder quest={quest} log={log} />
        </div>
      </div>
    </div>
  );
}

export function QuestsView() {
  const ch = useApp(activeCharacter)!;
  const target = useApp((s) => s.target);
  const t = useTerm();
  const [sel, setSel] = useState<string | null>(target?.type === "quest" ? target.id ?? null : null);
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const { data: quests } = useQuery((d) => repo.listQuests(d, ch.id), [ch.id], [] as Quest[]);
  useEffect(() => {
    if (target?.type === "quest" && target.id) setSel(target.id);
  }, [target]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return quests.filter((q) => !f || `${q.title} ${q.lastKnown} ${q.nextAction} ${q.notes}`.toLowerCase().includes(f));
  }, [quests, filter]);
  const groups: { label: string; items: Quest[]; open: boolean }[] = [
    { label: "Active", items: shown.filter((q) => q.status === "active"), open: true },
    { label: "Paused", items: shown.filter((q) => q.status === "paused"), open: true },
    { label: "Finished", items: shown.filter((q) => ["completed", "failed", "abandoned"].includes(q.status)), open: showDone || !!filter },
  ];
  const selected = quests.find((q) => q.id === sel) ?? null;
  const list = (
    <div className="list-pane">
      <QuickAdd
        placeholder="New quest title"
        onAdd={async (title) => {
          const id = await mutate((d) => repo.createQuest(d, ch.id, title));
          if (id) setSel(id);
        }}
      />
      <input className="field" placeholder="Filter quests" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {quests.length === 0 ? (
        <Empty icon="quests" title="No quests yet">
          Add the quests you care about. With the Morrowind bridge, quests from your in-game journal are imported automatically.
        </Empty>
      ) : null}
      {groups.map((g) =>
        g.items.length ? (
          <div key={g.label} className="list-group">
            <button className="list-group-head" onClick={() => g.label === "Finished" && setShowDone((v) => !v)}>
              {g.label} <span className="muted">{g.items.length}</span>
              {g.label === "Finished" ? <Icon name="chevron" size={14} className={g.open ? "rot90" : ""} /> : null}
            </button>
            {g.open
              ? g.items.map((q) => (
                  <button key={q.id} className={`list-item ${q.id === sel ? "on" : ""}`} onClick={() => setSel(q.id)}>
                    <span className="li-title">
                      {q.pinned ? <Icon name="star" size={12} /> : null} {q.title}
                    </span>
                    <span className="li-sub">
                      {q.source === "sync" ? <Pill tone="live">synced</Pill> : null}
                      {q.nextAction ? truncate(q.nextAction, 70) : q.lastKnown ? truncate(q.lastKnown, 70) : ""}
                    </span>
                  </button>
                ))
              : null}
          </div>
        ) : null,
      )}
    </div>
  );
  return (
    <Page title={t("quests")} subtitle={`${quests.filter((q) => q.status === "active").length} active`}>
      <ListDetail
        id="quests"
        showDetail={!!selected}
        list={list}
        detail={
          selected ? (
            <>
              <button className="back-link" onClick={() => { setSel(null); setState({ target: null }); }}>
                <Icon name="chevron" size={14} className="flip" /> All quests
              </button>
              <QuestDetail key={selected.id} quest={selected} />
            </>
          ) : (
            <Empty icon="quests" title="Choose a quest">Pick a quest on the left, or add a new one.</Empty>
          )
        }
      />
    </Page>
  );
}
