import { useState } from "react";
import { GAMES, SUPPORT_LABEL } from "../core/games.ts";
import { THEMES } from "../core/themes.ts";
import { createCharacter } from "./actions.ts";
import { Icon } from "../ui/icons.tsx";

export function Welcome() {
  const [gameId, setGameId] = useState("morrowind");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const game = GAMES.find((g) => g.id === gameId)!;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await createCharacter(gameId, name.trim() || "My character");
    setBusy(false);
  };
  return (
    <div className="welcome" data-theme={game.theme} data-variant={THEMES[game.theme].variants[0].id}>
      <div className="welcome-card">
        <div className="welcome-brand">CODEX.EXE</div>
        <h1>Start a journal</h1>
        <p className="welcome-lead">
          A companion for your second monitor: map, quests, people, notes and a &ldquo;where was I?&rdquo; recap. Pick the game you are playing &mdash; the whole app takes on its look. You can add more games and characters later.
        </p>
        <div className="welcome-games" role="radiogroup" aria-label="Game">
          {GAMES.map((g) => (
            <button
              key={g.id}
              role="radio"
              aria-checked={g.id === gameId}
              className={`game-card ${g.id === gameId ? "on" : ""}`}
              data-theme={g.theme}
              data-variant={THEMES[g.theme].variants[0].id}
              onClick={() => setGameId(g.id)}
            >
              <span className="game-card-name">{g.short}</span>
              <span className="game-card-year">{g.released}</span>
              <span className="game-card-level">{g.support === "enhanced" ? "Live bridge available" : "Manual companion"}</span>
            </button>
          ))}
        </div>
        <p className="welcome-support">
          <strong>{SUPPORT_LABEL[game.support]}.</strong> {game.supportNote}
        </p>
        <label className="welcome-name">
          <span>Character name</span>
          <input value={name} autoFocus placeholder="e.g. Nerevar" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
        </label>
        <button className="btn btn-primary welcome-go" onClick={() => void submit()} disabled={busy}>
          <Icon name="book" size={18} /> <span>Open the journal</span>
        </button>
        <p className="welcome-foot">Everything stays on this computer. No account, no internet needed.</p>
      </div>
    </div>
  );
}
