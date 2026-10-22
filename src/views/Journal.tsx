import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useQuery, mutate, navigate, db, getState, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import type { Note } from "../db/repo.ts";
import { Page, Panel, Btn, ConfirmBtn, Empty, Markdown, Tabs, Source, DataImage, Modal, Pill } from "../ui/bits.tsx";
import { Icon } from "../ui/icons.tsx";
import { useTerm } from "../ui/theme.ts";
import { toggleCheckbox, checklistProgress } from "../core/markdown.ts";
import { extractTags } from "../core/quick.ts";
import { formatDate, formatDateTime } from "../core/util.ts";
import { gameDateLabel } from "../core/sync.ts";
import { openQuick } from "../app/actions.ts";

type Tab = "notes" | "diary" | "timeline" | "gallery";

function Attachments({ noteId }: { noteId: string }) {
  const { data } = useQuery((d) => repo.listAttachments(d, "note", noteId), [noteId], [] as repo.Attachment[]);
  const [big, setBig] = useState<string | null>(null);
  if (!data.length) return null;
  return (
    <div className="thumbs">
      {data.map((a) => (
        <span key={a.id} className="thumb-wrap">
          <DataImage rel={a.file} alt={a.caption || "attachment"} className="thumb" onClick={() => setBig(a.file)} />
          <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteAttachment(d, a.id))} confirmText="Remove?" />
        </span>
      ))}
      {big ? (
        <Modal title="Screenshot" onClose={() => setBig(null)} wide>
          <DataImage rel={big} alt="attachment" className="lightbox" />
        </Modal>
      ) : null}
    </div>
  );
}

function NoteCard({ note, highlight }: { note: Note; highlight: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  useEffect(() => setText(note.body), [note.body]);
  const progress = checklistProgress(note.body);
  const save = async () => {
    await mutate((d) => repo.updateNote(d, note.id, { body: text, tags: extractTags(text) }));
    setEditing(false);
  };
  return (
    <article ref={ref} className={`note-card ${note.pinned ? "pinned" : ""} ${highlight ? "flash" : ""} ${note.kind === "diary" ? "diary-card" : ""}`}>
      <header className="note-meta">
        <span className="note-date">{formatDateTime(note.createdAt)}</span>
        {note.gameDate ? <span className="note-gamedate">{note.gameDate}</span> : null}
        {note.place ? (
          <span className="note-place">
            <Icon name="pin" size={13} /> {note.place} {note.placeSource === "live" ? <Source kind="live" /> : null}
          </span>
        ) : null}
        {progress.total ? <Pill tone={progress.done === progress.total ? "ok" : "plain"}>{progress.done}/{progress.total}</Pill> : null}
        <span className="grow" />
        <Btn small kind="ghost" icon="star" title={note.pinned ? "Unpin" : "Pin"} onClick={() => void mutate((d) => repo.updateNote(d, note.id, { pinned: !note.pinned }))} />
        <Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setEditing((e) => !e)} />
        <ConfirmBtn onConfirm={() => void mutate((d) => repo.deleteNote(d, note.id), "Note deleted.")} />
      </header>
      {note.title ? <h3 className="note-title">{note.title}</h3> : null}
      {editing ? (
        <div className="note-edit">
          <textarea className={`textblock ${note.kind === "diary" ? "hand" : ""}`} value={text} rows={Math.max(4, text.split("\n").length + 1)} onChange={(e) => setText(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) void save(); if (e.key === "Escape") { setText(note.body); setEditing(false); } }} />
          <div className="row">
            <Btn kind="primary" small icon="check" onClick={() => void save()}>Save</Btn>
            <Btn small kind="ghost" onClick={() => { setText(note.body); setEditing(false); }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <Markdown className={note.kind === "diary" ? "hand" : ""} text={note.body} onToggle={(line) => void mutate((d) => repo.updateNote(d, note.id, { body: toggleCheckbox(note.body, line) }))} />
      )}
      {note.tags.length ? (
        <div className="tags">
          {note.tags.map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
        </div>
      ) : null}
      <Attachments noteId={note.id} />
    </article>
  );
}

function NotesTab({ kind }: { kind: "note" | "diary" }) {
  const ch = useApp(activeCharacter)!;
  const target = useApp((s) => s.target);
  const live = useApp((s) => s.live.state);
  const fresh = useApp((s) => s.live.status.state === "live" || s.live.status.state === "limited");
  const t = useTerm();
  const [tag, setTag] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const { data: notes } = useQuery((d) => repo.listNotes(d, ch.id, { kind, limit: 2000 }), [ch.id, kind], [] as Note[]);
  const { data: tags } = useQuery((d) => repo.allTags(d, ch.id), [ch.id], [] as { tag: string; count: number }[]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return notes.filter((n) => (!tag || n.tags.includes(tag)) && (!f || `${n.title} ${n.body} ${n.place ?? ""}`.toLowerCase().includes(f)));
  }, [notes, tag, filter]);
  const diaryMode = kind === "diary";
  const ordered = diaryMode ? [...shown].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : shown;
  const add = async () => {
    if (!draft.trim()) return;
    await mutate((d) =>
      repo.addNote(d, {
        characterId: ch.id,
        kind,
        title: title.trim(),
        body: draft,
        tags: extractTags(draft),
        gameDate: fresh ? gameDateLabel(live?.time) : null,
        sessionId: getState().sessionId,
      }),
    );
    setDraft("");
    setTitle("");
  };
  return (
    <div className={`notes-tab ${diaryMode ? "diary-tab" : ""}`}>
      <div className="notes-tools">
        <input className="field" placeholder={diaryMode ? "Search the diary" : "Filter notes"} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {!diaryMode && tags.length ? (
          <div className="tag-filter">
            <button className={`tag ${tag === null ? "on" : ""}`} onClick={() => setTag(null)}>all</button>
            {tags.slice(0, 24).map((x) => (
              <button key={x.tag} className={`tag ${tag === x.tag ? "on" : ""}`} onClick={() => setTag(tag === x.tag ? null : x.tag)}>
                #{x.tag} <span className="muted">{x.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Panel className={`composer ${diaryMode ? "diary-composer" : ""}`} framed={diaryMode}>
        {diaryMode ? <input className="field diary-title" placeholder={gameDateLabel(live?.time) ?? "Entry title (optional)"} value={title} onChange={(e) => setTitle(e.target.value)} /> : null}
        <textarea
          className={`textblock ${diaryMode ? "hand" : ""}`}
          rows={diaryMode ? 6 : 3}
          value={draft}
          placeholder={diaryMode ? `Write as ${ch.name}… Your words are kept exactly as you write them.` : "Write a note…  (#tags, - [ ] checklist, **bold**)"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && void add()}
        />
        <div className="row">
          <span className="muted small">Ctrl+Enter to save{diaryMode ? "" : " · use the quick-note button to attach screenshots or a live location"}</span>
          <span className="grow" />
          {!diaryMode ? <Btn small icon="image" onClick={() => openQuick(draft)}>With image or place…</Btn> : null}
          <Btn kind="primary" small icon="check" onClick={() => void add()} disabled={!draft.trim()}>
            {diaryMode ? "Add entry" : "Add note"}
          </Btn>
        </div>
      </Panel>
      {ordered.length === 0 ? (
        <Empty icon={diaryMode ? "book" : "journal"} title={diaryMode ? `${ch.name}'s ${t("diary").toLowerCase()} is empty` : "No notes yet"}>
          {diaryMode ? "An optional in-character diary. Nothing here is ever rewritten." : "Quick thoughts while you play — press Ctrl+N anywhere, or the global hotkey from inside the game."}
        </Empty>
      ) : (
        <div className={diaryMode ? "diary-pages" : "note-list"}>
          {ordered.map((n) => (
            <NoteCard key={n.id} note={n} highlight={target?.id === n.id} />
          ))}
        </div>
      )}
    </div>
  );
}

interface TimelineItem {
  at: string;
  icon: string;
  text: string;
  source: "live" | "manual" | "app";
  go?: () => void;
}

function TimelineTab() {
  const ch = useApp(activeCharacter)!;
  const { data } = useQuery(
    async (d) => {
      const events = await repo.listEvents(d, ch.id, { limit: 1500 });
      const notes = await repo.listNotes(d, ch.id, { limit: 1500 });
      const sessions = await repo.listSessions(d, ch.id, 300);
      const items: TimelineItem[] = [
        ...events.map((e) => ({
          at: e.at,
          icon: e.kind === "quest" ? "quests" : e.kind === "discover" ? "map" : e.kind === "level" || e.kind === "skill" ? "character" : "dot",
          text: e.summary,
          source: e.source,
        })),
        ...notes.map((n) => ({
          at: n.createdAt,
          icon: n.kind === "diary" ? "book" : "journal",
          text: `${n.kind === "diary" ? "Diary" : "Note"}: ${n.title || n.body.split("\n")[0].slice(0, 100)}`,
          source: "manual" as const,
          go: () => navigate({ section: "journal", type: n.kind, id: n.id }),
        })),
        ...sessions.flatMap((s) => [
          { at: s.startedAt, icon: "play", text: "Session started", source: (s.source === "live" ? "live" : "manual") as "live" | "manual" },
          ...(s.endedAt ? [{ at: s.endedAt, icon: "stop", text: `Session ended${s.lastPlace ? ` in ${s.lastPlace}` : ""}${s.nextNote ? ` — next: ${s.nextNote.slice(0, 80)}` : ""}`, source: "manual" as const }] : []),
        ]),
      ];
      return items.sort((a, b) => b.at.localeCompare(a.at));
    },
    [ch.id],
    [] as TimelineItem[],
  );
  if (!data.length) return <Empty icon="clock" title="Nothing on the timeline yet">Notes, sessions, quest updates and discoveries appear here in order.</Empty>;
  let lastDay = "";
  return (
    <ol className="timeline">
      {data.map((it, i) => {
        const day = formatDate(it.at);
        const head = day !== lastDay;
        lastDay = day;
        return (
          <li key={i} className={head ? "tl-day-start" : ""}>
            {head ? <div className="tl-day">{day}</div> : null}
            <button className="tl-row" onClick={it.go} disabled={!it.go}>
              <span className="tl-time">{new Date(it.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
              <Icon name={it.icon} size={15} />
              <span className="tl-text">{it.text}</span>
              {it.source === "live" ? <Source kind="live" /> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function GalleryTab() {
  const ch = useApp(activeCharacter)!;
  const { data } = useQuery((d) => repo.listAllAttachments(d, ch.id), [ch.id], [] as repo.Attachment[]);
  const [big, setBig] = useState<repo.Attachment | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  useEffect(() => {
    void (async () => {
      const map: Record<string, Note> = {};
      for (const a of data) if (a.ownerType === "note" && !map[a.ownerId]) {
        const n = await repo.getNote(db(), a.ownerId);
        if (n) map[a.ownerId] = n;
      }
      setNotes(map);
    })();
  }, [data]);
  if (!data.length) return <Empty icon="image" title="No screenshots yet">Attach screenshots to notes with the quick-note button (newest screenshot, pick a file, or paste).</Empty>;
  return (
    <>
      <div className="gallery">
        {data.map((a) => (
          <figure key={a.id} className="gallery-item">
            <DataImage rel={a.file} alt={a.caption || "screenshot"} onClick={() => setBig(a)} />
            <figcaption>
              {notes[a.ownerId]?.place ? <span>{notes[a.ownerId].place} · </span> : null}
              {formatDate(a.createdAt)}
            </figcaption>
          </figure>
        ))}
      </div>
      {big ? (
        <Modal title={notes[big.ownerId]?.place ?? "Screenshot"} onClose={() => setBig(null)} wide>
          <DataImage rel={big.file} alt="screenshot" className="lightbox" />
          {notes[big.ownerId] ? <Markdown text={notes[big.ownerId].body} /> : null}
        </Modal>
      ) : null}
    </>
  );
}

export function JournalView() {
  const t = useTerm();
  const target = useApp((s) => s.target);
  const ch = useApp(activeCharacter)!;
  const [tab, setTab] = useState<Tab>(target?.type === "diary" ? "diary" : "notes");
  useEffect(() => {
    if (target?.type === "diary") setTab("diary");
    else if (target?.type === "note") setTab("notes");
  }, [target]);
  return (
    <Page title={t("journal")} subtitle={ch.name} actions={<Btn icon="plus" kind="primary" onClick={() => openQuick()}>{t("quickNote")}</Btn>}>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "notes", label: t("notes") },
          { id: "diary", label: t("diary") },
          { id: "timeline", label: t("timeline") },
          { id: "gallery", label: "Screenshots" },
        ]}
      />
      {tab === "notes" ? <NotesTab kind="note" /> : tab === "diary" ? <NotesTab kind="diary" /> : tab === "timeline" ? <TimelineTab /> : <GalleryTab />}
    </Page>
  );
}
