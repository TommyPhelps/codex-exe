import { useEffect, useRef, useState } from "react";
import { useApp, getState, mutate, db, toast, navigate, activeCharacter } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import { WORLD_MAP } from "../db/repo.ts";
import { cellLabel } from "../core/protocol.ts";
import { gameDateLabel } from "../core/sync.ts";
import { extractTags, parseNpcQuick } from "../core/quick.ts";
import { closeQuick } from "./actions.ts";
import { Icon } from "../ui/icons.tsx";
import { Btn, Select } from "../ui/bits.tsx";
import { useTerm } from "../ui/theme.ts";
import * as native from "../platform/native.ts";
import { defaultScreenshotDirs } from "./paths.ts";

export function QuickCapture() {
  const t = useTerm();
  const ch = useApp(activeCharacter);
  const seed = useApp((s) => s.quickSeed);
  const live = useApp((s) => s.live.state);
  const liveFresh = useApp((s) => s.live.status.state === "live" || s.live.status.state === "limited");
  const [body, setBody] = useState(seed);
  const [kind, setKind] = useState<"note" | "diary">("note");
  const [useLive, setUseLive] = useState(true);
  const [manualPlace, setManualPlace] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [questId, setQuestId] = useState("");
  const [quests, setQuests] = useState<repo.Quest[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, []);
  useEffect(() => {
    if (ch) void repo.listQuests(db(), ch.id).then((q) => setQuests(q.filter((x) => x.status === "active" || x.status === "paused")));
  }, [ch]);
  if (!ch) return null;

  const liveCell = liveFresh ? live?.cell : undefined;
  const place = useLive && liveCell ? cellLabel(liveCell) : manualPlace.trim() || null;
  const placeSource = useLive && liveCell ? "live" : manualPlace.trim() ? "manual" : null;

  const save = async () => {
    if (!body.trim() && !files.length) return;
    const pos = useLive && liveCell?.exterior && live?.pos ? live.pos : null;
    const id = await mutate((d) =>
      repo.addNote(d, {
        characterId: ch.id,
        kind,
        body,
        tags: extractTags(body),
        place,
        placeSource,
        wx: pos?.x ?? null,
        wy: pos?.y ?? null,
        gameDate: liveFresh ? gameDateLabel(live?.time) : null,
        sessionId: getState().sessionId,
      }),
    );
    if (!id) return;
    for (const f of files) await repo.addAttachment(db(), ch.id, "note", id, f);
    setSaved(id);
  };

  const attachNewest = async () => {
    const dirs = getState().prefs.screenshotDirs[ch.gameId]?.length ? getState().prefs.screenshotDirs[ch.gameId] : await defaultScreenshotDirs(ch.gameId);
    if (!dirs.length) {
      toast("Set your screenshot folder in Settings → Game first.", "error");
      return;
    }
    const found = await native.newestScreenshot(dirs).catch(() => null);
    if (!found) {
      toast("No screenshots found in your screenshot folder.", "error");
      return;
    }
    const rel = await native.importAttachment(found.path).catch((e: unknown) => {
      toast(String(e), "error");
      return null;
    });
    if (rel) setFiles((f) => [...f, rel]);
  };

  const attachPick = async () => {
    const p = await native.pickFile("Attach an image", [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"] }]).catch(() => null);
    if (!p) return;
    const rel = await native.importAttachment(p).catch((e: unknown) => {
      toast(String(e), "error");
      return null;
    });
    if (rel) setFiles((f) => [...f, rel]);
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const blob = item.getAsFile();
    if (!blob) return;
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const ext = item.type.split("/")[1] === "jpeg" ? "jpg" : item.type.split("/")[1] || "png";
    const rel = await native.saveAttachmentBytes(ext, bytes).catch((err: unknown) => {
      toast(String(err), "error");
      return null;
    });
    if (rel) setFiles((f) => [...f, rel]);
  };

  const firstLine = body.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? "Note";

  const toMarker = async () => {
    if (liveCell?.exterior && live?.pos) {
      await mutate((d) => repo.addMarker(d, ch.id, { mapId: WORLD_MAP, x: live.pos!.x, y: live.pos!.y, category: "revisit", label: firstLine, note: body }), "Marker added at your current position.");
      closeQuick();
    } else {
      closeQuick();
      navigate({ section: "map", type: "newMarker", extra: firstLine });
      toast("Double-click the map where the marker should go.");
    }
  };
  const toClue = async () => {
    if (!questId) return;
    await mutate((d) => repo.addEntry(d, ch.id, { scope: "quest", parentId: questId, kind: "clue", title: firstLine, body, place: place ?? "" }), "Added as a clue.");
    closeQuick();
  };
  const toPerson = async () => {
    const p = parseNpcQuick(firstLine);
    const id = await mutate((d) => repo.createNpc(d, ch.id, { name: p.name, place: p.place || place || "", notes: p.note || body }));
    if (id) navigate({ section: "people", type: "npc", id });
    closeQuick();
  };

  return (
    <div className="quick-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeQuick()}>
      <div className="quick panel framed" role="dialog" aria-label={t("quickNote")}>
        <div className="quick-head">
          <h2>
            <Icon name="journal" size={18} /> {t("quickNote")}
          </h2>
          <div className="seg" role="group" aria-label="Kind">
            <button className={kind === "note" ? "on" : ""} onClick={() => setKind("note")}>
              Note
            </button>
            <button className={kind === "diary" ? "on" : ""} onClick={() => setKind("diary")}>
              {t("diary")} entry
            </button>
          </div>
          <Btn icon="close" kind="ghost" title="Close (Esc)" onClick={closeQuick} />
        </div>
        {saved ? (
          <div className="quick-after">
            <p className="ok-line">
              <Icon name="check" size={16} /> Saved{place ? ` — ${place}` : ""}.
            </p>
            <div className="quick-after-actions">
              <Btn icon="pin" onClick={() => void toMarker()}>
                Turn into a map marker
              </Btn>
              <Btn icon="person" onClick={() => void toPerson()}>
                Save as a person
              </Btn>
              <span className="inline-group">
                <Select value={questId} onChange={setQuestId} options={[{ value: "", label: "Add as a clue to…" }, ...quests.map((q) => ({ value: q.id, label: q.title }))]} />
                <Btn icon="plus" disabled={!questId} onClick={() => void toClue()}>
                  Add clue
                </Btn>
              </span>
              <Btn kind="primary" onClick={closeQuick}>
                Done
              </Btn>
            </div>
          </div>
        ) : (
          <>
            <textarea
              ref={area}
              className={`textblock quick-text ${kind === "diary" ? "hand" : ""}`}
              value={body}
              placeholder={kind === "diary" ? "Write in your character's voice… (kept exactly as written)" : "What did you just learn? (#tags, - [ ] checklists and **bold** work)"}
              onChange={(e) => setBody(e.target.value)}
              onPaste={(e) => void onPaste(e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
                if (e.key === "Escape") closeQuick();
              }}
              rows={6}
            />
            <div className="quick-meta">
              {liveCell ? (
                <label className={`chip ${useLive ? "on" : ""}`} title="Recorded from the game bridge">
                  <input type="checkbox" checked={useLive} onChange={(e) => setUseLive(e.target.checked)} />
                  <Icon name="pin" size={14} /> {cellLabel(liveCell)} <span className="src">LIVE</span>
                </label>
              ) : null}
              {!liveCell || !useLive ? (
                <input className="field small" placeholder="Place (optional)" value={manualPlace} onChange={(e) => setManualPlace(e.target.value)} />
              ) : null}
              <Btn small icon="image" onClick={() => void attachNewest()} title="Attach the newest image from your screenshot folder">
                Newest screenshot
              </Btn>
              <Btn small icon="folder" onClick={() => void attachPick()}>
                Image…
              </Btn>
              {files.length ? <span className="muted">{files.length} image{files.length === 1 ? "" : "s"} attached</span> : null}
            </div>
            <div className="quick-foot">
              <span className="muted">Ctrl+Enter to save · Esc to close · paste images directly</span>
              <Btn kind="primary" icon="check" onClick={() => void save()} disabled={!body.trim() && !files.length}>
                Save
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
