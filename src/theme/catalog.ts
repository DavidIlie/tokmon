/**
 * Paired palettes imported from ZeroCut's common Theme/ThemeColors catalog.
 *
 * Keep this source-shaped instead of flattening it into renderer variables: the
 * shared theme engine adapts it once, and the web editor can use any entry as a
 * custom starting point without each surface inventing a palette mapping.
 */
export interface CatalogThemeColors {
  name: string
  primary: string
  background: string
  foreground: string
  card: string
  cardForeground: string
  border: string
  accent: string
  accentForeground: string
  muted: string
  mutedForeground: string
}
export interface CatalogTheme {
  name: string
  light: CatalogThemeColors
  dark: CatalogThemeColors
}

export const IMPORTED_THEME_IDS = [
  'vscode', 'monokai', 'dracula', 'github', 'nord', 'one-dark-pro',
  'solarized', 'tokyo-night', 'catppuccin', 'midnight', 'forest',
  'sunset', 'cyberpunk', 'synthwave', 'luxury', 'minimal',
] as const

export type ImportedThemeId = typeof IMPORTED_THEME_IDS[number]

export const IMPORTED_THEME_CATALOG: Record<ImportedThemeId, CatalogTheme> = {
  vscode: {
    name: 'VS Code',
    light: { name: 'Light+', primary: '#007ACC', background: '#FFFFFF', foreground: '#333333', card: '#F3F3F3', cardForeground: '#1E1E1E', border: '#E5E5E5', accent: '#0066BF', accentForeground: '#FFFFFF', muted: '#F6F6F6', mutedForeground: '#6E6E6E' },
    dark: { name: 'Dark+', primary: '#007ACC', background: '#1E1E1E', foreground: '#CCCCCC', card: '#252526', cardForeground: '#CCCCCC', border: '#3E3E42', accent: '#0E639C', accentForeground: '#FFFFFF', muted: '#2D2D30', mutedForeground: '#858585' },
  },
  monokai: {
    name: 'Monokai',
    light: { name: 'Monokai Light', primary: '#A6E22E', background: '#F8F8F2', foreground: '#272822', card: '#E6E6E0', cardForeground: '#272822', border: '#C4C4B8', accent: '#66D9EF', accentForeground: '#272822', muted: '#E6E6E0', mutedForeground: '#75715E' },
    dark: { name: 'Monokai', primary: '#A6E22E', background: '#272822', foreground: '#F8F8F2', card: '#3E3D32', cardForeground: '#F8F8F2', border: '#75715E', accent: '#66D9EF', accentForeground: '#272822', muted: '#49483E', mutedForeground: '#75715E' },
  },
  dracula: {
    name: 'Dracula',
    light: { name: 'Dracula Light', primary: '#BD93F9', background: '#F8F8F2', foreground: '#282A36', card: '#E6E6E0', cardForeground: '#282A36', border: '#C4C4B8', accent: '#FF79C6', accentForeground: '#282A36', muted: '#E6E6E0', mutedForeground: '#6272A4' },
    dark: { name: 'Dracula', primary: '#BD93F9', background: '#282A36', foreground: '#F8F8F2', card: '#343746', cardForeground: '#F8F8F2', border: '#44475A', accent: '#FF79C6', accentForeground: '#282A36', muted: '#44475A', mutedForeground: '#6272A4' },
  },
  github: {
    name: 'GitHub',
    light: { name: 'GitHub Light', primary: '#0969DA', background: '#FFFFFF', foreground: '#24292F', card: '#F6F8FA', cardForeground: '#24292F', border: '#D0D7DE', accent: '#0969DA', accentForeground: '#FFFFFF', muted: '#F6F8FA', mutedForeground: '#57606A' },
    dark: { name: 'GitHub Dark', primary: '#58A6FF', background: '#0D1117', foreground: '#C9D1D9', card: '#161B22', cardForeground: '#C9D1D9', border: '#30363D', accent: '#1F6FEB', accentForeground: '#FFFFFF', muted: '#161B22', mutedForeground: '#8B949E' },
  },
  nord: {
    name: 'Nord',
    light: { name: 'Nord Light', primary: '#5E81AC', background: '#ECEFF4', foreground: '#2E3440', card: '#E5E9F0', cardForeground: '#2E3440', border: '#D8DEE9', accent: '#88C0D0', accentForeground: '#2E3440', muted: '#E5E9F0', mutedForeground: '#4C566A' },
    dark: { name: 'Nord', primary: '#88C0D0', background: '#2E3440', foreground: '#D8DEE9', card: '#3B4252', cardForeground: '#E5E9F0', border: '#434C5E', accent: '#5E81AC', accentForeground: '#ECEFF4', muted: '#434C5E', mutedForeground: '#88C0D0' },
  },
  'one-dark-pro': {
    name: 'One Dark Pro',
    light: { name: 'One Light Pro', primary: '#528BFF', background: '#FAFAFA', foreground: '#383A42', card: '#F0F0F0', cardForeground: '#383A42', border: '#E0E0E0', accent: '#61AFEF', accentForeground: '#FAFAFA', muted: '#F0F0F0', mutedForeground: '#5C6370' },
    dark: { name: 'One Dark Pro', primary: '#61AFEF', background: '#282C34', foreground: '#ABB2BF', card: '#2C313C', cardForeground: '#ABB2BF', border: '#3E4451', accent: '#528BFF', accentForeground: '#FFFFFF', muted: '#3E4451', mutedForeground: '#5C6370' },
  },
  solarized: {
    name: 'Solarized',
    light: { name: 'Solarized Light', primary: '#268BD2', background: '#FDF6E3', foreground: '#657B83', card: '#EEE8D5', cardForeground: '#586E75', border: '#93A1A1', accent: '#2AA198', accentForeground: '#FDF6E3', muted: '#FDF6E3', mutedForeground: '#839496' },
    dark: { name: 'Solarized Dark', primary: '#268BD2', background: '#002B36', foreground: '#839496', card: '#073642', cardForeground: '#93A1A1', border: '#586E75', accent: '#2AA198', accentForeground: '#FDF6E3', muted: '#073642', mutedForeground: '#657B83' },
  },
  'tokyo-night': {
    name: 'Tokyo Night',
    light: { name: 'Tokyo Night Day', primary: '#2E7DE9', background: '#E1E2E7', foreground: '#343B58', card: '#D5D6DB', cardForeground: '#343B58', border: '#9699A3', accent: '#7AA2F7', accentForeground: '#343B58', muted: '#D5D6DB', mutedForeground: '#565F89' },
    dark: { name: 'Tokyo Night', primary: '#7AA2F7', background: '#1A1B26', foreground: '#C0CAF5', card: '#24283B', cardForeground: '#C0CAF5', border: '#414868', accent: '#BB9AF7', accentForeground: '#1A1B26', muted: '#2F3549', mutedForeground: '#565F89' },
  },
  catppuccin: {
    name: 'Catppuccin',
    light: { name: 'Catppuccin Latte', primary: '#1E66F5', background: '#EFF1F5', foreground: '#4C4F69', card: '#E6E9EF', cardForeground: '#4C4F69', border: '#BCC0CC', accent: '#EA76CB', accentForeground: '#EFF1F5', muted: '#E6E9EF', mutedForeground: '#6C6F85' },
    dark: { name: 'Catppuccin Mocha', primary: '#89B4FA', background: '#1E1E2E', foreground: '#CDD6F4', card: '#313244', cardForeground: '#CDD6F4', border: '#45475A', accent: '#F38BA8', accentForeground: '#1E1E2E', muted: '#313244', mutedForeground: '#6C7086' },
  },
  midnight: {
    name: 'Midnight',
    light: { name: 'Midnight Light', primary: '#3B82F6', background: '#F8FAFC', foreground: '#0F172A', card: '#E2E8F0', cardForeground: '#0F172A', border: '#CBD5E1', accent: '#1D4ED8', accentForeground: '#F8FAFC', muted: '#E2E8F0', mutedForeground: '#64748B' },
    dark: { name: 'Midnight', primary: '#3B82F6', background: '#0F172A', foreground: '#F8FAFC', card: '#1E293B', cardForeground: '#F8FAFC', border: '#334155', accent: '#1D4ED8', accentForeground: '#FFFFFF', muted: '#1E293B', mutedForeground: '#94A3B8' },
  },
  forest: {
    name: 'Forest',
    light: { name: 'Forest Light', primary: '#22C55E', background: '#F0FDF4', foreground: '#052E16', card: '#DCFCE7', cardForeground: '#052E16', border: '#BBF7D0', accent: '#15803D', accentForeground: '#F0FDF4', muted: '#DCFCE7', mutedForeground: '#166534' },
    dark: { name: 'Forest', primary: '#22C55E', background: '#052E16', foreground: '#DCFCE7', card: '#14532D', cardForeground: '#DCFCE7', border: '#166534', accent: '#15803D', accentForeground: '#FFFFFF', muted: '#14532D', mutedForeground: '#86EFAC' },
  },
  sunset: {
    name: 'Sunset',
    light: { name: 'Sunset Light', primary: '#F97316', background: '#FFF7ED', foreground: '#431407', card: '#FFEDD5', cardForeground: '#431407', border: '#FED7AA', accent: '#EA580C', accentForeground: '#FFF7ED', muted: '#FFEDD5', mutedForeground: '#9A3412' },
    dark: { name: 'Sunset', primary: '#F97316', background: '#431407', foreground: '#FFEDD5', card: '#7C2D12', cardForeground: '#FFEDD5', border: '#9A3412', accent: '#EA580C', accentForeground: '#FFFFFF', muted: '#7C2D12', mutedForeground: '#FDBA74' },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    light: { name: 'Cyberpunk Light', primary: '#F472B6', background: '#FFFFFF', foreground: '#000000', card: '#F3F4F6', cardForeground: '#000000', border: '#E5E7EB', accent: '#E879F9', accentForeground: '#000000', muted: '#F3F4F6', mutedForeground: '#22D3EE' },
    dark: { name: 'Cyberpunk', primary: '#F472B6', background: '#000000', foreground: '#22D3EE', card: '#111111', cardForeground: '#E879F9', border: '#F472B6', accent: '#FFFF00', accentForeground: '#000000', muted: '#111111', mutedForeground: '#22D3EE' },
  },
  synthwave: {
    name: 'Synthwave',
    light: { name: 'Synthwave Light', primary: '#D946EF', background: '#FAF5FF', foreground: '#2A0A3B', card: '#F3E8FF', cardForeground: '#2A0A3B', border: '#E9D5FF', accent: '#06B6D4', accentForeground: '#FAF5FF', muted: '#F3E8FF', mutedForeground: '#C026D3' },
    dark: { name: 'Synthwave', primary: '#D946EF', background: '#2A0A3B', foreground: '#F5D0FE', card: '#4A1D66', cardForeground: '#F5D0FE', border: '#C026D3', accent: '#06B6D4', accentForeground: '#FFFFFF', muted: '#4A1D66', mutedForeground: '#E879F9' },
  },
  luxury: {
    name: 'Luxury',
    light: { name: 'Luxury Light', primary: '#D4AF37', background: '#FAFAF9', foreground: '#1C1917', card: '#F5F5F4', cardForeground: '#1C1917', border: '#E7E5E4', accent: '#B45309', accentForeground: '#FAFAF9', muted: '#F5F5F4', mutedForeground: '#78716C' },
    dark: { name: 'Luxury', primary: '#D4AF37', background: '#1C1917', foreground: '#E7E5E4', card: '#292524', cardForeground: '#D4AF37', border: '#78716C', accent: '#B45309', accentForeground: '#FFFFFF', muted: '#292524', mutedForeground: '#A8A29E' },
  },
  minimal: {
    name: 'Minimal',
    light: { name: 'Minimal', primary: '#18181B', background: '#FFFFFF', foreground: '#18181B', card: '#FFFFFF', cardForeground: '#18181B', border: '#E4E4E7', accent: '#F4F4F5', accentForeground: '#18181B', muted: '#FAFAFA', mutedForeground: '#71717A' },
    dark: { name: 'Minimal Dark', primary: '#FAFAFA', background: '#18181B', foreground: '#FAFAFA', card: '#27272A', cardForeground: '#FAFAFA', border: '#3F3F46', accent: '#27272A', accentForeground: '#FAFAFA', muted: '#27272A', mutedForeground: '#A1A1AA' },
  },
}
