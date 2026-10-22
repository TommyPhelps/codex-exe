import * as native from "../platform/native.ts";
import { bridgeConfig } from "./prefs.ts";

/** Best-guess screenshot folders when the player has not set any. */
export async function defaultScreenshotDirs(gameId: string): Promise<string[]> {
  if (gameId !== "morrowind") return [];
  const cfg = bridgeConfig(gameId);
  const out: string[] = [];
  if (cfg.engine === "openmw" || cfg.engine === "none") {
    const dirs = await native.userDirs().catch(() => null);
    if (dirs) out.push(dirs.openmwScreenshots);
  }
  if (cfg.gameDir && cfg.engine !== "openmw") {
    const base = cfg.gameDir.replace(/[\\/]+$/, "");
    out.push(base, `${base}\\Screenshots`, `${base}\\MGE3\\Screenshots`);
  }
  return out;
}
