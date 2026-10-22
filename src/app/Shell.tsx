import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useApp, setState, navigate, activeCharacter } from "../state/store.ts";
import type { AppState } from "../state/store.ts";
import { useTheme, useGame, useTerm } from "../ui/theme.ts";
import { SECTIONS, term } from "../core/themes.ts";
import type { SectionId, ThemeDef } from "../core/themes.ts";
import { Icon, SECTION_ICON } from "../ui/icons.tsx";
import { Btn } from "../ui/bits.tsx";
import { cellLabel } from "../core/protocol.ts";
import { gameById } from "../core/games.ts";
import type { LiveCell } from "../core/protocol.ts";
import { relativeTime } from "../core/util.ts";
import { selectCharacter, setMode, openQuick } from "./actions.ts";
import { savePrefs } from "./prefs.ts";
import * as native from "../platform/native.ts";
import { linkSyncName, dismissBinding } from "./live.ts";
import { QuickCapture } from "./QuickCapture.tsx";
import { Palette } from "./Palette.tsx";
import { ReminderBanner } from "./Reminders.tsx";
import { ResumeView } from "../views/Resume.tsx";
import { MapView } from "../views/MapView.tsx";
import { QuestsView } from "../views/Quests.tsx";
import { PeopleView } from "../views/People.tsx";
import { JournalView } from "../views/Journal.tsx";
import { DiscoveriesView } from "../views/Discoveries.tsx";
import { CharacterView } from "../views/Character.tsx";
import { TravelView } from "../views/Travel.tsx";
import { DelvesView } from "../views/Delves.tsx";
import { LedgerView } from "../views/Ledger.tsx";
import { SettingsView } from "../views/Settings.tsx";

const VIEWS: Record<SectionId, () => JSX.Element> = {
  resume: ResumeView,
  map: MapView,
  quests: QuestsView,
  people: PeopleView,
  journal: JournalView,
  discoveries: DiscoveriesView,
  character: CharacterView,
  travel: TravelView,
  delves: DelvesView,
  ledger: LedgerView,
  settings: SettingsView,
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function NavBar({ theme, section }: { theme: ThemeDef; section: SectionId }) {
  const items = SECTIONS.map((id) => ({ id, label: term(theme, id), icon: SECTION_ICON[id] }));
  const go = (id: SectionId) => navigate({ section: id });
  if (theme.groups) {
    const group = theme.groups.find((g) => g.sections.includes(section)) ?? theme.groups[0];
    return (
      <nav className="nav nav-terminal" aria-label="Sections">
        <div className="term-groups">
          {theme.groups.map((g) => (
            <button key={g.label} className={`term-group ${g === group ? "on" : ""}`} onClick={() => go(g.sections[0])}>
              {g.label}
            </button>
          ))}
        </div>
        {group.sections.length > 1 ? (
          <div className="term-subs">
            {group.sections.map((id) => (
              <button key={id} className={`term-sub ${id === section ? "on" : ""}`} onClick={() => go(id)}>
                {term(theme, id)}
              </button>
            ))}
          </div>
        ) : null}
      </nav>
    );
  }
  return (
    <nav className={`nav nav-${theme.nav}`} aria-label="Sections">
      {theme.nav === "ribbons" ? <div className="spine-cap" aria-hidden="true" /> : null}
      {items.map((it, i) => (
        <button key={it.id} className={`nav-item ${it.id === section ? "on" : ""}`} onClick={() => go(it.id)} title={it.label} aria-current={it.id === section ? "page" : undefined}>
          {theme.nav === "chapters" ? <span className="nav-num">{ROMAN[i]}</span> : null}
          {theme.nav !== "nordic" ? <Icon name={it.icon} size={theme.nav === "pda" ? 20 : 18} /> : null}
          <span className="nav-label">{it.label}</span>
          {theme.nav === "nordic" && i < items.length - 1 ? <span className="nav-sep" aria-hidden="true">{theme.fleuron}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function StatusLamp() {
  const status = useApp((s) => s.live.status);
  const engine = useApp((s) => s.live.engineVersion);
  const lastAt = useApp((s) => s.live.lastAt);
  const [open, setOpen] = useState(false);
  return (
    <div className="status-wrap">
      <button className={`status status-${status.state}`} onClick={() => setOpen((o) => !o)} title={status.detail} aria-expanded={open}>
        <span className="lamp" aria-hidden="true" />
        <span className="status-label">{status.label}</span>
      </button>
      {open ? (
        <div className="popover status-pop" onMouseLeave={() => setOpen(false)}>
          <div className="pop-title">{status.label}</div>
          <p>{status.detail}</p>
          {engine ? <p className="muted">Bridge: {engine}</p> : null}
          {lastAt ? <p className="muted">Last data: {relativeTime(new Date(lastAt).toISOString())}</p> : null}
          <Btn small icon="settings" onClick={() => { setOpen(false); navigate({ section: "settings", extra: "bridge" }); }}>
            Bridge settings
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

const selectLiveCell = (s: AppState): LiveCell | undefined => s.live.state?.cell;

function Whereabouts() {
  const cell = useApp(selectLiveCell);
  const fresh = useApp((s) => s.live.status.state === "live" || s.live.status.state === "limited");
  const last = useApp((s) => activeCharacter(s)?.live as { cell?: LiveCell; receivedAt?: string } | undefined);
  if (cell && fresh) {
    return (
      <div className="whereabouts live" title="Reported by the game bridge">
        <Icon name="pin" size={15} />
        <span>{cellLabel(cell)}</span>
        <span className="src">LIVE</span>
      </div>
    );
  }
  if (last?.cell) {
    return (
      <div className="whereabouts" title="Last place the game reported">
        <Icon name="pin" size={15} />
        <span>Last seen: {cellLabel(last.cell)}</span>
        {last.receivedAt ? <span className="muted">{relativeTime(last.receivedAt)}</span> : null}
      </div>
    );
  }
  return null;
}

function CharacterSwitch() {
  const characters = useApp((s) => s.characters);
  const activeId = useApp((s) => s.activeId);
  return (
    <select
      className="char-switch"
      value={activeId ?? ""}
      onChange={(e) => {
        if (e.target.value === "__new") navigate({ section: "settings", extra: "profiles" });
        else void selectCharacter(e.target.value);
      }}
      aria-label="Character"
    >
      {characters.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} — {gameById(c.gameId).short}
        </option>
      ))}
      <option value="__new">+ New character…</option>
    </select>
  );
}

function BindingBanner() {
  const binding = useApp((s) => s.live.binding);
  const ch = useApp(activeCharacter);
  if (!binding || binding.status === "bound") return null;
  const name = binding.syncName;
  return (
    <div className="banner">
      <Icon name="live" size={18} />
      <span>
        The game reports a character named <strong>{name}</strong>. Live data is only saved after you choose where it belongs.
      </span>
      {ch && ch.gameId === "morrowind" ? (
        <Btn small kind="primary" onClick={() => void linkSyncName(ch.id, name)}>
          Link to {ch.name}
        </Btn>
      ) : null}
      <Btn small onClick={() => navigate({ section: "settings", extra: "profiles" })}>Choose…</Btn>
      <Btn small kind="ghost" onClick={dismissBinding}>Not now</Btn>
    </div>
  );
}

function Notices() {
  const notices = useApp((s) => s.live.notices);
  const toasts = useApp((s) => s.toasts);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);
  const shown = notices.filter((n) => now - n.at < 10000);
  return (
    <div className="notices" aria-live="polite">
      {shown.map((n) => (
        <div key={n.id} className="notice">
          <Icon name="live" size={14} /> {n.text}
        </div>
      ))}
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Shell() {
  const theme = useTheme();
  const game = useGame();
  const t = useTerm();
  const section = useApp((s) => s.section);
  const mode = useApp((s) => s.mode);
  const quickOpen = useApp((s) => s.quickOpen);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const onTop = useApp((s) => s.prefs.alwaysOnTop);
  const View = VIEWS[mode === "map" ? "map" : mode === "journal" ? "journal" : section];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openQuick();
      } else if (e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key) && !typing) {
        e.preventDefault();
        const id = SECTIONS[Number(e.key) - 1];
        if (id) navigate({ section: id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app app-${theme.navPlacement} mode-${mode}`}>
      <div className="app-material" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          {t("brand") ? <span className="brand-word">{t("brand")}</span> : null}
          <CharacterSwitch />
          <span className="brand-game">{game.short}</span>
        </div>
        <Whereabouts />
        <div className="topbar-actions">
          <StatusLamp />
          <Btn icon="search" kind="ghost" title="Search everything (Ctrl+K)" onClick={() => setState({ paletteOpen: true })} />
          <Btn icon="journal" kind="primary" title={`${t("quickNote")} (Ctrl+N)`} onClick={() => openQuick()}>
            <span className="hide-compact">{t("quickNote")}</span>
          </Btn>
          <div className="mode-buttons" role="group" aria-label="Layout">
            <Btn icon="compact" kind={mode === "compact" ? "primary" : "ghost"} title="Compact mode (Ctrl+Shift+M)" onClick={() => setMode(mode === "compact" ? "normal" : "compact")} />
            <Btn icon="map" kind={mode === "map" ? "primary" : "ghost"} title="Full map mode" onClick={() => setMode(mode === "map" ? "normal" : "map")} />
            <Btn icon="book" kind={mode === "journal" ? "primary" : "ghost"} title="Full journal mode" onClick={() => setMode(mode === "journal" ? "normal" : "journal")} />
            <Btn
              icon="ontop"
              kind={onTop ? "primary" : "ghost"}
              title={onTop ? "Always on top: on" : "Always on top: off"}
              onClick={() => {
                void savePrefs({ alwaysOnTop: !onTop });
                void native.setAlwaysOnTop(!onTop).catch(() => {});
              }}
            />
          </div>
        </div>
      </header>
      <BindingBanner />
      <ReminderBanner />
      <div className="app-body">
        {mode === "map" || mode === "journal" ? null : <NavBar theme={theme} section={section} />}
        <main className={`main section-${mode === "map" ? "map" : mode === "journal" ? "journal" : section}`}>
          <View key={`${section}-${mode}`} />
        </main>
      </div>
      {quickOpen ? <QuickCapture /> : null}
      {paletteOpen ? <Palette /> : null}
      <Notices />
    </div>
  );
}
