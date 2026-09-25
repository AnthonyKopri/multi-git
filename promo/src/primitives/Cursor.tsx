// A natural pointer. Stops are kept in stage (app) coordinates and pushed
// through the camera every frame (`map`), so the pointer stays glued to the UI
// while the camera moves. Between stops it glides on a gentle arc (a quadratic
// curve bowed by 10% of the distance) with an ease-in-out, taking
// clamp(10 + distance / 60, 10, 24) frames, arriving at least 5 frames before
// a click and leaving no sooner than 6 frames after one. A press is 3 frames
// at 0.88 with a small ring; the target gets a 1.5 px indigo hover ring as the
// pointer arrives and a flash on the press (12 frames), fading over 7 frames.
// A ring belongs to its target: `from` keeps it hidden until the target's
// layer has finished opening (so the first frames fit), and `until` fades it
// out over 4 frames as that layer starts to close (so no outline is left
// floating where a button was).
import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import { clamp01, prog } from '../lib/anim';
import { useColors } from '../theme';

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
/** `at` is the click frame for a click, otherwise the arrival frame. */
export interface CursorStop { at: number; x: number; y: number; click?: boolean; ring?: Box; from?: number; until?: number }
export const RING_OUT = 4;
export type CursorMap = (frame: number, p: Pt) => Pt;

const identity: CursorMap = (_f, p) => p;
const easeInOut = (t: number) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
export const ARRIVE_EARLY = 5, DWELL = 6;

interface Seg { a: CursorStop; b: CursorStop; start: number; end: number }
export function cursorPlan(stops: CursorStop[], map: CursorMap = identity): Seg[] {
  const segs: Seg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const arrive = b.click ? b.at - ARRIVE_EARLY : b.at;
    const pa = map(arrive, a), pb = map(arrive, b);
    const dur = Math.min(24, Math.max(10, 10 + Math.hypot(pb.x - pa.x, pb.y - pa.y) / 60));
    const earliest = a.at + (a.click ? DWELL : 0);
    const start = Math.max(earliest, arrive - dur);
    segs.push({ a, b, start, end: Math.max(start + 1, arrive) });
  }
  return segs;
}

/** The pointer's stage position at `frame`. */
export function cursorAt(stops: CursorStop[], segs: Seg[], frame: number): Pt {
  let p: Pt = stops[0];
  for (const s of segs) {
    if (frame < s.start) break;
    if (frame >= s.end) { p = s.b; continue; }
    const t = easeInOut((frame - s.start) / (s.end - s.start));
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, d = Math.hypot(dx, dy) || 1;
    // Bow the path downwards, like a wrist pivoting.
    let nx = -dy / d, ny = dx / d;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const cx = (s.a.x + s.b.x) / 2 + nx * d * 0.1, cy = (s.a.y + s.b.y) / 2 + ny * d * 0.1;
    const u = 1 - t;
    return { x: u * u * s.a.x + 2 * u * t * cx + t * t * s.b.x, y: u * u * s.a.y + 2 * u * t * cy + t * t * s.b.y };
  }
  return p;
}

export const Cursor: React.FC<{ stops: CursorStop[]; enterAt: number; exitAt?: number; map?: CursorMap; scale?: number }> = ({ stops, enterAt, exitAt, map = identity, scale = 1 }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  // A first glide too short to read starts the pointer on its first target instead.
  const plan = useMemo(() => {
    let st = stops;
    const first = cursorPlan(st, map)[0];
    if (first && first.end - first.start < 6) st = [{ ...st[1], at: st[0].at, click: false }, ...st.slice(1)];
    return { st, segs: cursorPlan(st, map) };
  }, [stops, map]);
  if (frame < enterAt || (exitAt !== undefined && frame >= exitAt + 6)) return null;
  const vis = clamp01((frame - enterAt + 1) / 6) * (exitAt === undefined ? 1 : clamp01((exitAt + 6 - frame) / 6));
  const p = map(frame, cursorAt(plan.st, plan.segs, frame));
  const clicks = plan.st.filter((s) => s.click).map((s) => s.at);
  const pressed = clicks.some((f) => frame >= f && frame < f + 3);
  const rings = plan.st.map((s, i) => {
    if (!s.ring) return null;
    const seg = plan.segs[i - 1];
    const arrive = seg ? seg.end : s.at;
    const leaveAt = plan.segs[i] ? Math.max(plan.segs[i].start, s.at + 10) : (exitAt ?? s.at + 30);
    const start = Math.max(arrive - 2, s.from ?? -Infinity);
    const gone = Math.min(leaveAt + 7, s.until !== undefined ? s.until + RING_OUT : Infinity);
    if (frame < start || frame >= gone) return null;
    const closing = s.until !== undefined ? clamp01((s.until + RING_OUT - frame) / RING_OUT) : 1;
    const on = clamp01((frame - start + 1) / 5) * clamp01((leaveAt + 7 - frame) / 7) * closing;
    const flash = s.click && frame >= s.at ? (1 - prog(frame, s.at, 12)) * closing : 0;
    const tl = map(frame, { x: s.ring.x, y: s.ring.y }), br = map(frame, { x: s.ring.x + s.ring.w, y: s.ring.y + s.ring.h });
    // border-box keeps the border inside the box, so the 4 px gap around the target is even on all
    // four sides (content-box pushed the outline 3 px down and right). The radius follows the zoom,
    // so the corners match the app's 6 px radius at any scale.
    const zoom = (br.x - tl.x) / Math.max(1, s.ring.w);    return (
      <div key={i} style={{ position: 'absolute', boxSizing: 'border-box', left: tl.x - 4, top: tl.y - 4, width: br.x - tl.x + 8, height: br.y - tl.y + 8, borderRadius: 6 * zoom + 4, pointerEvents: 'none',
        border: `${1.5 + flash}px solid ${c.indigo}`, opacity: on, boxShadow: flash > 0 ? `0 0 ${10 + 16 * flash}px ${c.indigo}` : 'none', background: flash > 0 ? `rgba(99,102,241,${(0.16 * flash).toFixed(3)})` : 'transparent' }} />
    );
  });
  return (
    <>
      {rings}
      <div style={{ position: 'absolute', left: p.x, top: p.y, pointerEvents: 'none', opacity: vis, transform: `scale(${scale * (pressed ? 0.88 : 1)})`, transformOrigin: '0 0', zIndex: 50 }}>
        {clicks.map((f, i) => {
          const t = prog(frame, f, 12);
          if (frame < f || t >= 1) return null;
          return <div key={i} style={{ position: 'absolute', left: -18 * (0.4 + t), top: -18 * (0.4 + t), width: 36 * (0.4 + t), height: 36 * (0.4 + t), borderRadius: '50%', border: `2.5px solid ${c.indigo}`, opacity: 1 - t }} />;
        })}
        <svg width={34} height={40} viewBox="0 0 17 20" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.6))' }}>
          <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" fill="#f3f4f6" stroke="#0a0c10" strokeWidth={1.2} strokeLinejoin="round" />
        </svg>
      </div>
    </>
  );
};
