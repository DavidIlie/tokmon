import {
  IMPORTED_THEME_CATALOG,
  IMPORTED_THEME_IDS,
  type CatalogThemeColors,
} from "../../../src/theme/catalog.ts";

export const DEFAULT_THEME_ID = "tokmon";
export const THEME_STORAGE_KEY = "tokmon:site-theme:v1";

export const SITE_THEME_VARS = [
  "--bg-0", "--bg-1", "--bg-2", "--bg-3",
  "--line", "--line-2", "--line-faint",
  "--fg", "--fg-dim", "--fg-faint", "--fg-bright",
  "--accent", "--accent-text", "--cost", "--code-fg", "--positive",
  "--ok", "--warning", "--critical", "--unknown",
  "--accent-tint", "--accent-on", "--focus-ring",
] as const;

export type SiteThemeVar = typeof SITE_THEME_VARS[number];

export interface SiteThemeSource extends CatalogThemeColors {
  id: string;
  tokens?: Partial<Record<SiteThemeVar, string>>;
}

export interface SiteTheme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
  scheme: "dark" | "light";
  vars: Record<SiteThemeVar, string>;
}

const TOKMON: SiteThemeSource = {
  id: "tokmon", name: "Tokmon", primary: "#79be7e", background: "#0a0a0a",
  foreground: "#d4d6d6", card: "#101011", cardForeground: "#f3f5f5",
  border: "#262627", accent: "#d9c074", accentForeground: "#0a0a0a",
  muted: "#161617", mutedForeground: "#8d9090",
  tokens: {
    "--bg-3": "#1d1d1e", "--line-2": "#343435", "--line-faint": "#1a1a1b",
    "--fg-dim": "#8d9090", "--fg-faint": "#585b5b", "--accent-tint": "#18251a",
  },
};

const PHOSPHOR: SiteThemeSource = {
  id: "phosphor", name: "Phosphor", primary: "#35f38a", background: "#000000",
  foreground: "#c6f7d3", card: "#050705", cardForeground: "#eafff0",
  border: "#1a2a1e", accent: "#ffd24a", accentForeground: "#000000",
  muted: "#0a0f0b", mutedForeground: "#7fc98d",
  tokens: {
    "--bg-3": "#101710", "--line-2": "#2c4634", "--line-faint": "#101812",
    "--fg-dim": "#7fc98d", "--fg-faint": "#4c7d57",
  },
};

export const SITE_THEME_SOURCES: readonly SiteThemeSource[] = [
  TOKMON,
  PHOSPHOR,
  ...IMPORTED_THEME_IDS.map((id) => ({ id, ...IMPORTED_THEME_CATALOG[id].dark })),
];

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeHexColor(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

function hexChannel(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
}

export function mixColors(from: string, to: string, amount: number): string {
  const [fr, fg, fb] = channels(from);
  const [tr, tg, tb] = channels(to);
  const ratio = Math.max(0, Math.min(1, amount));
  return `#${hexChannel(fr + (tr - fr) * ratio)}${hexChannel(fg + (tg - fg) * ratio)}${hexChannel(fb + (tb - fb) * ratio)}`;
}

export function relativeLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex);
  if (!normalized) throw new TypeError("expected a #RRGGBB color");
  const linear = channels(normalized).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function accessibleColor(color: string, backgrounds: readonly string[], minimum: number, toward: string): string {
  const intended = normalizeHexColor(color)!;
  if (backgrounds.every((background) => contrastRatio(intended, background) >= minimum)) return intended;
  const target = [toward, "#000000", "#ffffff"].reduce((best, candidate) => (
    Math.min(...backgrounds.map((background) => contrastRatio(candidate, background)))
      > Math.min(...backgrounds.map((background) => contrastRatio(best, background))) ? candidate : best
  ));
  let low = 0;
  let high = 1;
  for (let index = 0; index < 16; index++) {
    const mid = (low + high) / 2;
    const candidate = mixColors(intended, target, mid);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= minimum)) high = mid;
    else low = mid;
  }
  return mixColors(intended, target, high);
}

export function deriveSiteTheme(source: SiteThemeSource): SiteTheme {
  const bg0 = normalizeHexColor(source.background)!;
  const bg1 = normalizeHexColor(source.card)!;
  const bg2 = normalizeHexColor(source.muted)!;
  const contrastTarget = relativeLuminance(bg0) > 0.5 ? "#000000" : "#ffffff";
  const fg = accessibleColor(source.foreground, [bg0, bg1], 4.5, contrastTarget);
  const fgBright = accessibleColor(source.cardForeground, [bg0, bg1], 4.5, contrastTarget);
  const fgDim = accessibleColor(source.mutedForeground, [bg0], 3, fg);
  const accent = accessibleColor(source.primary, [bg0, bg1], 3, fg);
  const accentText = accessibleColor(source.primary, [bg0, bg1], 4.5, fg);
  const cost = accessibleColor(source.accent, [bg1], 3, fg);
  const codeFg = accessibleColor(source.accent, [bg2], 4.5, fg);
  const positive = accessibleColor(source.primary, [bg1], 3, fg);
  const truth = { ok: "#79be7e", warning: "#e0b84c", critical: "#e5584b" };
  const vars: Record<SiteThemeVar, string> = {
    "--bg-0": bg0,
    "--bg-1": bg1,
    "--bg-2": bg2,
    "--bg-3": mixColors(source.muted, source.foreground, 0.08),
    "--line": normalizeHexColor(source.border)!,
    "--line-2": mixColors(source.border, source.foreground, 0.18),
    "--line-faint": mixColors(source.background, source.border, 0.5),
    "--fg": fg,
    "--fg-dim": fgDim,
    "--fg-faint": normalizeHexColor(source.mutedForeground)!,
    "--fg-bright": fgBright,
    "--accent": accent,
    "--accent-text": accentText,
    "--cost": cost,
    "--code-fg": codeFg,
    "--positive": positive,
    "--ok": accessibleColor(truth.ok, [bg1], 3, fg),
    "--warning": accessibleColor(truth.warning, [bg1], 3, fg),
    "--critical": accessibleColor(truth.critical, [bg1], 3, fg),
    "--unknown": fgDim,
    "--accent-tint": mixColors(bg1, accent, 0.14),
    "--accent-on": contrastRatio(accent, "#000000") >= contrastRatio(accent, "#ffffff") ? "#000000" : "#ffffff",
    "--focus-ring": accent,
  };
  Object.assign(vars, source.tokens);
  return {
    id: source.id,
    name: source.name,
    bg: bg0,
    fg,
    accent,
    scheme: relativeLuminance(bg0) > 0.5 ? "light" : "dark",
    vars,
  };
}

export const SITE_THEMES: readonly SiteTheme[] = SITE_THEME_SOURCES.map(deriveSiteTheme);

export function themeBootstrapData() {
  return {
    vars: SITE_THEME_VARS,
    table: Object.fromEntries(SITE_THEMES.map((theme) => [theme.id, SITE_THEME_VARS.map((key) => theme.vars[key])])),
    names: Object.fromEntries(SITE_THEMES.map((theme) => [theme.id, theme.name])),
    schemes: Object.fromEntries(SITE_THEMES.map((theme) => [theme.id, theme.scheme])),
    key: THEME_STORAGE_KEY,
    defaultId: DEFAULT_THEME_ID,
  };
}
