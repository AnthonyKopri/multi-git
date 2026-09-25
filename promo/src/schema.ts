// The Studio-editable props: every on-screen string (from copy.json), the
// colours, scene lengths in bars, music/SFX volume and the counter switch.
import { z } from 'zod';
import { zColor } from '@remotion/zod-types';
import copyJson from './copy.json';
import { DEFAULT_COLORS } from './theme';
import { TIMING, type CompositionId } from './timing';

// Derive a zod schema from a JSON value, so Studio shows every field.
function schemaOf(v: unknown): z.ZodTypeAny {
  if (typeof v === 'string') return z.string();
  if (typeof v === 'number') return z.number();
  if (typeof v === 'boolean') return z.boolean();
  if (Array.isArray(v)) return z.array(v.length ? schemaOf(v[0]) : z.string());
  if (v && typeof v === 'object') return z.object(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, schemaOf(x)])));
  return z.any();
}
export type Copy = typeof copyJson;
const copySchema = schemaOf(copyJson) as unknown as z.ZodType<Copy>;
const colorsSchema = z.object(Object.fromEntries(Object.keys(DEFAULT_COLORS).map((k) => [k, zColor()]))) as unknown as z.ZodType<typeof DEFAULT_COLORS>;

export const promoSchema = z.object({
  copy: copySchema,
  colors: colorsSchema,
  sceneBars: z.record(z.string(), z.number().int().min(1).max(16)),
  musicVolume: z.number().min(0).max(2),
  sfxVolume: z.number().min(0).max(2),
  showCounter: z.boolean(),
});
export type PromoProps = z.infer<typeof promoSchema>;

export const barsOf = (id: CompositionId) =>
  Object.fromEntries(TIMING.compositions[id].arrangement.map((a) => [a.section, a.toBar - a.fromBar + 1]));

export const defaultPropsFor = (id: CompositionId): PromoProps => ({
  copy: copyJson,
  colors: { ...DEFAULT_COLORS },
  sceneBars: barsOf(id),
  musicVolume: 1,
  sfxVolume: 1,
  showCounter: id !== 'ReadmeGif',
});
