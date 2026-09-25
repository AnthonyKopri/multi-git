// Timing and easing helpers. Typing is the only linear motion in the film.
import { spring } from 'remotion';

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const expoOut = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(t)));
export const expoIn = (t: number) => (t <= 0 ? 0 : 2 ** (10 * clamp01(t) - 10));
export const expoInOut = (t: number) => {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
};
export const prog = (frame: number, start: number, dur: number) => clamp01((frame - start) / Math.max(1, dur));
/** 0 -> 1, expo-out over 8-12 frames (entrances). */
export const enter = (frame: number, at: number, dur = 10) => expoOut(prog(frame, at, dur));
/** 1 -> 0, expo-in over 6-8 frames (exits). */
export const leave = (frame: number, at: number, dur = 7) => 1 - expoIn(prog(frame, at, dur));
/** Visible window: enters at `at`, leaves at `until` (if given). */
export const inOut = (frame: number, at: number, until?: number, inDur = 10, outDur = 7) =>
  enter(frame, at, inDur) * (until === undefined ? 1 : leave(frame, until, outDur));
export const SPRING_UI = { damping: 15, stiffness: 200, mass: 0.8 };
export const pop = (frame: number, at: number, fps = 30, config = SPRING_UI) =>
  frame < at ? 0 : spring({ frame: frame - at, fps, config });
/** The collapse target pulse: 1 -> 1.08 -> 1 over 6 frames. */
export const pulse = (frame: number, at: number, dur = 6, amp = 0.08) => {
  const t = prog(frame, at, dur);
  return frame < at || t >= 1 ? 1 : 1 + amp * Math.sin(Math.PI * t);
};
/** Small deterministic screen shake: at most 6 px, at most 4 frames. */
export const shake = (frame: number, at: number, amp = 5) => {
  const k = Math.floor(frame - at); // motion blur renders fractional sub-frames
  if (k < 0 || k >= 4) return { x: 0, y: 0 };
  const pattern = [[1, -0.6], [-0.8, 0.9], [0.5, -0.4], [-0.2, 0.2]];
  return { x: pattern[k][0] * amp, y: pattern[k][1] * amp };
};
