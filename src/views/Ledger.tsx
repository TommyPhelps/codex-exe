import { useApp, activeCharacter } from "../state/store.ts";
import { Page, Panel, Source } from "../ui/bits.tsx";
import { EntryList } from "../ui/entries.tsx";
import type { KindDef } from "../ui/entries.tsx";
import { useTerm, useGame } from "../ui/theme.ts";
import { exampleText } from "../core/games.ts";
import type { LiveCharacter } from "../core/protocol.ts";
import { relativeTime } from "../core/util.ts";

const KINDS: KindDef[] = [
  { id: "storage", label: "Stored items", icon: "chest", check: false },
  { id: "merchant", label: "Useful merchants", icon: "coin", check: false },
  { id: "trainer", label: "Trainers", icon: "sword", check: false },
  { id: "service", label: "Services to come back for", icon: "hint" },
  { id: "buy", label: "To buy", icon: "coin" },
  { id: "sell", label: "To sell", icon: "export" },
  { id: "equipment", label: "Equipment plans", icon: "character" },
];

const PANELS: { kind: string; title: string; placeholder: string; empty: string }[] = [
  { kind: "storage", title: "Where I stored things", placeholder: "Extra armor in a chest @ {town}", empty: "“I stored my extra armor in a chest in {town}” — type it, press Enter." },
  { kind: "merchant", title: "Useful merchants", placeholder: "Sells cheap potions @ {town2}", empty: "Merchants worth remembering, and what they sell." },
  { kind: "trainer", title: "Trainers", placeholder: "Trains a skill (too pricey for now) @ {town}", empty: "Who trains what, and whether you could afford it." },
  { kind: "service", title: "Services to come back for", placeholder: "Someone who can repair or enchant @ {town2}", empty: "" },
  { kind: "buy", title: "To buy", placeholder: "Restore Health potions", empty: "" },
  { kind: "sell", title: "To sell", placeholder: "Spare armor @ any trader", empty: "" },
  { kind: "equipment", title: "Equipment plans", placeholder: "Upgrade to a better helmet", empty: "" },
];

export function LedgerView() {
  const ch = useApp(activeCharacter)!;
  const game = useGame();
  const t = useTerm();
  const fresh = useApp((s) => ["live", "limited"].includes(s.live.status.state));
  const liveChar = useApp((s) => s.live.state?.character);
  const saved = ch.live as { character?: LiveCharacter; receivedAt?: string };
  const inv = fresh && liveChar?.inventory ? liveChar.inventory : saved.character?.inventory;
  const invFresh = !!(fresh && liveChar?.inventory);
  return (
    <Page title={t("ledger")} subtitle="Stores, stashes, merchants and plans — only what you write down">
      <div className="grid-panels ledger-grid">
        {PANELS.map((p) => (
          <Panel key={p.kind} title={p.title}>
            <EntryList characterId={ch.id} scope="ledger" kinds={KINDS} only={[p.kind]} placeholder={exampleText(p.placeholder, game)} showPlace emptyText={exampleText(p.empty, game)} />
          </Panel>
        ))}
        {inv && inv.length ? (
          <Panel title={<>Carried right now {invFresh ? <Source kind="live" /> : <span className="muted small">(last report {saved.receivedAt ? relativeTime(saved.receivedAt) : ""})</span>}</>}>
            <p className="muted small">What the game bridge reports you are carrying. CODEX.EXE never knows what is inside containers — only what you note above.</p>
            <ul className="inv-list">
              {inv.map((it, i) => (
                <li key={i}>
                  <span>{it.name}</span>
                  {it.count !== 1 ? <span className="muted">×{it.count}</span> : null}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </Page>
  );
}
