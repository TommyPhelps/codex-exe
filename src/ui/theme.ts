import { useApp, activeCharacter } from "../state/store.ts";
import type { AppState } from "../state/store.ts";
import { gameById } from "../core/games.ts";
import type { GameAdapter, ThemeId } from "../core/games.ts";
import { themeOf, term, defaultVariant, mapStyle } from "../core/themes.ts";
import type { ThemeDef, TermKey, MapStyle } from "../core/themes.ts";

export function themeIdOf(s: AppState): ThemeId {
  const o = s.prefs.themeOverride;
  if (o && o in themeIdsSet) return o as ThemeId;
  const ch = activeCharacter(s);
  return gameById(ch?.gameId).theme;
}

const themeIdsSet: Record<string, true> = {
  morrowind: true, daggerfall: true, oblivion: true, skyrim: true, falloutnv: true, kotor: true, gothic: true, stalker: true,
};

export function variantOf(s: AppState, t: ThemeDef): string {
  const v = s.prefs.variants[t.id];
  return v && t.variants.some((x) => x.id === v) ? v : defaultVariant(t);
}

export function useTheme(): ThemeDef {
  return themeOf(useApp(themeIdOf));
}

export function useVariant(): string {
  const t = useTheme();
  return useApp((s) => variantOf(s, t));
}

export function useMapStyle(): MapStyle {
  const t = useTheme();
  const v = useVariant();
  return mapStyle(t, v);
}

export function useGame(): GameAdapter {
  return gameById(useApp((s) => activeCharacter(s)?.gameId ?? null));
}

export function useTerm(): (k: TermKey) => string {
  const t = useTheme();
  return (k: TermKey) => term(t, k);
}

/** Puts the theme on <html> so CSS can switch materials, fonts and layout. */
export function applyThemeToDocument(s: AppState): void {
  const t = themeOf(themeIdOf(s));
  const v = variantOf(s, t);
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.dataset.variant = v;
  root.dataset.dark = String(t.variants.find((x) => x.id === v)?.dark ?? false);
  root.dataset.deco = s.prefs.decorations ? "on" : "off";
  root.dataset.mode = s.mode;
  root.dataset.nav = t.navPlacement;
  root.style.setProperty("--font-scale", String(s.prefs.fontScale));
}
