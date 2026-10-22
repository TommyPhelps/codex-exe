import { useState } from "react";
import { useApp, useQuery, mutate, navigate, setState, getState, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import { loadResume, summarize } from "../core/resume.ts";
import type { ResumeData } from "../core/resume.ts";
import { Page, Panel, Btn, Empty, Pill, TextBlock, QuickAdd, Select, ConfirmBtn } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { formatDate, relativeTime, truncate } from "../core/util.ts";
import { cellLabel } from "../core/protocol.ts";
import { parseAtPlace } from "../core/quick.ts";

const EMPTY: ResumeData = {
  characterName: "", session: null, sessionOpen: false, events: [], visits: [], quests: [], delves: [], reminders: [], needs: [], pinned: [], sessionNotes: [], discoveries: [],
};

function SessionControls({ data }: { data: ResumeData }) {
  const ch = useApp(activeCharacter)!;
  const live = useApp((s) => s.live.state);
  const fresh = useApp((s) => s.live.status.state === "live" || s.live.status.state === "limited");
  const t = useTerm();
  const [ending, setEnding] = useState(false);
  const [next, setNext] = useState("");
  const [place, setPlace] = useState("");
  const s = data.session;
  if (data.sessionOpen && s) {
    if (!ending) {
      return (
        <div className="session-bar">
          <Pill tone={s.source === "live" ? "live" : "accent"}>{s.source === "live" ? "Session (from the game)" : "Session"} since {relativeTime(s.startedAt)}</Pill>
          <Btn icon="stop" onClick={() => setEnding(true)}>
            End session
          </Btn>
        </div>
      );
    }
    const liveCell = fresh && live?.cell ? cellLabel(live.cell) : null;
    return (
      <div className="session-end">
        <label className="field-label">{t("nextTime")}: what do you want to do when you come back?</label>
        <textarea className="textblock hand" value={next} onChange={(e) => setNext(e.target.value)} rows={3} placeholder="e.g. Check the buildings on the western bank before dark." autoFocus />
        <div className="row">
          {liveCell ? (
            <span className="muted">
              Stopping in <strong>{liveCell}</strong> <Pill tone="live">LIVE</Pill>
            </span>
          ) : (
            <input className="field" placeholder="Where did you stop? (optional)" value={place} onChange={(e) => setPlace(e.target.value)} />
          )}
          <Btn
            kind="primary"
            icon="check"
            onClick={async () => {
              await mutate((d) =>
                repo.endSession(d, s.id, {
                  nextNote: next,
                  lastPlace: liveCell ?? (place.trim() || null),
                  lastPlaceSource: liveCell ? "live" : place.trim() ? "manual" : null,
                }),
              "Session saved.");
              if (getState().sessionId === s.id) setState({ sessionId: null });
              setEnding(false);
            }}
          >
            Save &amp; end
          </Btn>
          <Btn kind="ghost" onClick={() => setEnding(false)}>
            Cancel
          </Btn>
        </div>
      </div>
    );
  }
  return (
    <div className="session-bar">
      <Btn
        icon="play"
        kind="primary"
        onClick={async () => {
          const id = await mutate((d) => repo.startSession(d, ch.id, "manual"));
          if (id) setState({ sessionId: id });
        }}
      >
        Start a session
      </Btn>
      <span className="muted">With the game bridge running, sessions start and end on their own.</span>
    </div>
  );
}

function NextTimeNote({ data }: { data: ResumeData }) {
  const t = useTerm();
  const s = data.session;
  if (!s || data.sessionOpen) return null;
  if (s.nextNote.trim()) {
    return (
      <div className="next-time">
        <div className="next-time-label">{t("nextTime")}</div>
        <div className="hand next-time-text">{s.nextNote}</div>
      </div>
    );
  }
  return (
    <div className="next-time empty-next">
      <div className="next-time-label">{t("nextTime")}</div>
      <TextBlock value="" hand rows={2} placeholder="The last session has no 'next time' note yet. What were you about to do?" onSave={(v) => void mutate((d) => repo.setSessionNote(d, s.id, v))} />
    </div>
  );
}

const REMINDER_KINDS = [
  { value: "anytime", label: "Whenever" },
  { value: "next_session", label: "Next session" },
  { value: "level", label: "When I level up" },
  { value: "place", label: "When I'm at…" },
];

function Reminders({ items }: { items: repo.Entry[] }) {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const [kind, setKind] = useState("anytime");
  return (
    <Panel title="Reminders" className="span-1">
      {items.length === 0 ? <p className="muted">Nothing pending. Add one below — e.g. &ldquo;Return to the trainer when I level up&rdquo;.</p> : null}
      <ul className="list compact-list">
        {items.map((r) => (
          <li key={r.id} className="list-row">
            <button className="check-box" onClick={() => void mutate((d) => repo.updateEntry(d, r.id, { done: true }))} title="Mark done">
              <Icon name="check" size={13} />
            </button>
            <span className="grow">
              {r.title}
              <span className="muted small">
                {" "}
                {r.kind === "level" ? "· on level up" : r.kind === "place" ? `· at ${r.place}` : r.kind === "next_session" ? "· next session" : ""}
              </span>
            </span>
            <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteEntry(d, r.id))} />
          </li>
        ))}
      </ul>
      <div className="row">
        <Select value={kind} onChange={setKind} options={REMINDER_KINDS} />
        <div className="grow">
          <QuickAdd
            placeholder={kind === "place" ? `Check the shop @ ${game.examples.town}` : "Remind me to…"}
            onAdd={async (text) => {
              const p = kind === "place" ? parseAtPlace(text) : { title: text, place: "" };
              await mutate((d) => repo.addEntry(d, ch.id, { scope: "reminder", kind, title: p.title, place: p.place }));
            }}
          />
        </div>
      </div>
      <p className="muted small">Place and level reminders trigger from live game data; with manual play they wait here.</p>
    </Panel>
  );
}

export function ResumeView() {
  const ch = useApp(activeCharacter)!;
  const t = useTerm();
  const game = useGame();
  const { data } = useQuery((d) => loadResume(d, ch.id), [ch.id], EMPTY);
  const lines = summarize(data);
  return (
    <Page title={t("resume")} subtitle={`${ch.name} · ${game.short}`} className="resume">
      <Panel framed className="resume-hero">
        <div className="hero-head">
          <Icon name="resume" size={22} />
          <h2>Resume adventure</h2>
        </div>
        <div className="recap">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        <NextTimeNote data={data} />
        <SessionControls data={data} />
      </Panel>

      <div className="grid-panels">
        <Panel title="Active quests" actions={<Btn small kind="ghost" icon="arrowRight" onClick={() => navigate({ section: "quests" })} title="All quests" />}>
          {data.quests.length === 0 ? (
            <Empty icon="quests" title="No active quests">
              Add one in Quests{game.support === "enhanced" ? ", or let the bridge import them from your journal" : ""}.
            </Empty>
          ) : (
            <ul className="list">
              {data.quests.slice(0, 6).map((q) => (
                <li key={q.id}>
                  <button className="list-link" onClick={() => navigate({ section: "quests", type: "quest", id: q.id })}>
                    <span className="lt">{q.title}</span>
                    {q.nextAction ? <span className="ls hand">Next: {truncate(q.nextAction, 90)}</span> : q.lastKnown ? <span className="ls">{truncate(q.lastKnown, 90)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Unfinished dungeons" actions={<Btn small kind="ghost" icon="arrowRight" onClick={() => navigate({ section: "delves" })} title="All dungeons" />}>
          {data.delves.length === 0 ? (
            <p className="muted">No dungeons left half-done.</p>
          ) : (
            <ul className="list">
              {data.delves.map((d) => (
                <li key={d.id}>
                  <button className="list-link" onClick={() => navigate({ section: "delves", type: "delve", id: d.id })}>
                    <span className="lt">
                      {d.name} <Pill tone={d.status === "left" ? "warn" : "accent"}>{d.status === "left" ? "left unfinished" : "exploring"}</Pill>
                    </span>
                    {d.reason ? <span className="ls hand">{truncate(d.reason, 100)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Reminders items={data.reminders} />

        <Panel title="On your list">
          {data.needs.length === 0 ? (
            <p className="muted">Items to buy and things quests still need appear here.</p>
          ) : (
            <ul className="list compact-list">
              {data.needs.slice(0, 10).map((n, i) => (
                <li key={i} className="list-row">
                  <Icon name="dot" size={10} />
                  <span className="grow">{n.title}</span>
                  <span className="muted small">{n.from}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pinned notes" actions={<Btn small kind="ghost" icon="arrowRight" onClick={() => navigate({ section: "journal" })} title="Journal" />}>
          {data.pinned.length === 0 ? (
            <p className="muted">Pin important notes in the journal to keep them here.</p>
          ) : (
            <ul className="list">
              {data.pinned.map((n) => (
                <li key={n.id}>
                  <button className="list-link" onClick={() => navigate({ section: "journal", type: "note", id: n.id })}>
                    <span className="lt">{n.title || truncate(n.body, 70)}</span>
                    <span className="ls">{n.place ? `${n.place} · ` : ""}{formatDate(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recently visited">
          {data.visits.length === 0 ? (
            <p className="muted">Places the game reports (or you mark as visited) show up here.</p>
          ) : (
            <ul className="list compact-list">
              {data.visits.slice(0, 8).map((v) => (
                <li key={v.placeKey} className="list-row">
                  <Icon name="pin" size={13} />
                  <span className="grow">{v.name}</span>
                  <span className="muted small">{relativeTime(v.lastAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {data.discoveries.length ? (
          <Panel title="Recent discoveries">
            <ul className="list compact-list">
              {data.discoveries.map((d, i) => (
                <li key={i} className="list-row">
                  <Icon name="discoveries" size={13} />
                  <span className="grow">{d.name}</span>
                  <span className="muted small">{d.category}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </Page>
  );
}
