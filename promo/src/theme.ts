// Colour tokens (from the app's public/style.css and the logo) and type roles.
import { createContext, useContext } from 'react';
import type { CompositionId } from './timing';
import type { PromoProps } from './schema';

export const DEFAULT_COLORS = {
  background: '#0a0c10',
  trueBlack: '#000000',
  panel: '#11141a',
  card: '#171b26',
  border: '#262e3d',
  indigo: '#6366f1',
  indigoHover: '#4f46e5',
  logo: '#6A69EB',
  disc: '#3B3E8D',
  cyan: '#06b6d4',
  emerald: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  text: '#f3f4f6',
  muted: '#9ca3af',
  dim: '#6b7280',
  // Spell text. The spec's dim (#6b7280) is 4.1:1 on the background, under the
  // 4.5:1 floor, so spell glyphs use this slightly lighter grey (6.4:1).
  spell: '#8b94a3',
};
export type Colors = typeof DEFAULT_COLORS;

export const FONT = {
  sans: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export const TYPE = {
  hero: { fontFamily: FONT.sans, fontWeight: 700, fontSize: 120, letterSpacing: '-0.02em', lineHeight: 1.0 },
  sub: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 48, lineHeight: 1.15 },
  chip: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 26, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  spell: { fontFamily: FONT.mono, fontWeight: 400, fontSize: 28, lineHeight: 1.35 },
  keycap: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 40 },
  counter: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 28 },
  small: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 30, lineHeight: 1.3 },
};

export const SAFE = { x: 96, y: 54 };

export interface FilmContext {
  comp: CompositionId;
  props: PromoProps;
  colors: Colors;
  copy: PromoProps['copy'];
  width: number;
  height: number;
}
export const FilmCtx = createContext<FilmContext | null>(null);
export const useFilm = (): FilmContext => {
  const c = useContext(FilmCtx);
  if (!c) throw new Error('useFilm outside a film composition');
  return c;
};
export const useColors = () => useFilm().colors;
