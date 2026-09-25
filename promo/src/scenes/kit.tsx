// Shared scene building blocks: the app window made of real captured DOM
// layers, camera helpers, cues, headline slots and transitions.
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { measureText } from '@remotion/layout-utils';
import { useCurrentFrame } from 'remotion';
import RECTS from '../ui/rects.generated.json';
import { SNAP } from '../ui/snapshots.generated';
import { cameraAt, type CamKey } from '../primitives/Camera';
import { Headline, Kinetic } from '../primitives/Headline';
import { LaneTrails } from '../primitives/LaneTrails';
import { FONT, useColors, TYPE } from '../theme';
import { cueOf, type SectionDef } from '../timing';
import type { Apply } from '../ui/AppSnapshot';
import { clamp01, enter, leave, prog } from '../lib/anim';

export interface R { x: number; y: number; w: number; h: number }
export const rect = (layer: string, sel: string): R => ((RECTS as Record<string, Record<string, R | null>>)[layer]?.[sel]) ?? { x: 0, y: 0, w: 0, h: 0 };
export const mid = (r: R) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const grow = (r: R, d: number): R => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export const cues = (def: SectionDef) => ({
  at: (name: string, fallback = 0) => cueOf(def, name) ?? fallback,
  has: (name: string) => cueOf(def, name) !== null,
});

export const APP = { w: 1600, h: 1000 };
export const FEATURE_ANCHOR = { x: 1190, y: 650 };

/** Where a world rect (app coordinates) lands on screen under a camera. */
export function toScreen(keys: CamKey[], frame: number, world: R, anchor = FEATURE_ANCHOR, drift = 0.015, driftFrames = 240): R {
  const c = cameraAt(keys, frame);
  const s = c.scale * (1 + drift * Math.min(1, frame / driftFrames));
  return { x: anchor.x + (world.x - c.x) * s, y: anchor.y + (world.y - c.y) * s, w: world.w * s, h: world.h * s };
}

/**
 * One layer of captured app DOM inside the 1600x1000 app box. `at` places a
 * fragment (a single captured element) where it sits in the real app.
 */
export const AppLayer: React.FC<{ snap: string; at?: R | 'full' | 'bottom'; apply?: Apply; opacity?: number; base?: boolean; style?: React.CSSProperties; holderStyle?: React.CSSProperties }> = ({ snap, at = 'full', apply, opacity = 1, base = false, style, holderStyle }) => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current && apply) apply(ref.current, frame); });
  const html = SNAP[snap] ?? `<div style="color:red;font-size:30px">missing ${snap}</div>`;
  const holder: React.CSSProperties = at === 'full' ? { position: 'absolute', left: 0, top: 0, width: APP.w, height: APP.h }
    : at === 'bottom' ? { position: 'absolute', left: 0, bottom: 0, width: APP.w }
    : { position: 'absolute', left: at.x, top: at.y, width: at.w };
  if (opacity <= 0) return null;
  return (
    <div className="mg-app" style={{ position: 'absolute', left: 0, top: 0, width: APP.w, height: APP.h, background: base ? undefined : 'transparent', overflow: 'visible', opacity, pointerEvents: 'none', ...style }}>
      <div ref={ref} style={{ ...holder, ...holderStyle }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};

/** The app window frame (rounded, bordered) in world coordinates. */
export const AppWindow: React.FC<{ children: React.ReactNode; glow?: string }> = ({ children, glow }) => {
  const c = useColors();
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: APP.w, height: APP.h, borderRadius: 16, overflow: 'hidden', border: `1.5px solid ${c.border}`,
      boxShadow: `0 40px 120px rgba(0,0,0,0.65)${glow ? `, 0 0 90px ${glow}40` : ''}`, background: c.panel,
      // A transform makes this box the containing block for the app's
      // position:fixed dialogs, so they centre on the app, as in the app.
      transform: 'translate(0px, 0px)' }}>
      {children}
    </div>
  );
};

/** Top-left scrim so headlines keep >= 4.5:1 over the UI. */
export const HeadlineScrim: React.FC<{ width?: number; height?: number; opacity?: number }> = ({ width = 1250, height = 460, opacity = 1 }) => {
  const c = useColors();
  if (opacity <= 0) return null;
  return <div style={{ position: 'absolute', left: 0, top: 0, width, height, opacity, background: `radial-gradient(ellipse at 0% 0%, ${c.background}f5 0%, ${c.background}e0 45%, transparent 75%)`, pointerEvents: 'none' }} />;
};

// ---------------------------------------------------------- headline block --
/** How many lines `text` wraps to at `size` in `width`, breaking at spaces as the Kinetic spans do. */
export function wrapLines(text: string, size: number, width: number, weight = '700', letterSpacing = '-0.02em') {
  const m = (t: string) => measureText({ text: t, fontFamily: FONT.sans, fontSize: size, fontWeight: weight, letterSpacing }).width;
  const space = m(' ');
  let lines = 1, x = 0;
  for (const w of text.replace(/[*`]/g, '').split(/\s+/).filter(Boolean)) {
    const ww = m(w);
    if (x > 0 && x + space + ww > width * 0.97) { lines++; x = ww; } else x += (x > 0 ? space : 0) + ww;
  }
  return lines;
}

export interface BlockLine { text: string; at: number; exitAt?: number; kind?: 'headline' | 'sub'; size?: number; color?: string }
export const HL = { x: 96, top: 70, width: 1100, gap: 28, size: 112 };

/** Lays the lines out: a headline shrinks (4 px at a time) until it takes two lines or fewer. */
export function blockLayout(lines: BlockLine[], width = HL.width, gap = HL.gap) {
  let height = 0;
  const items = lines.map((l, i) => {
    const kind = l.kind ?? 'headline';
    let size = l.size ?? (kind === 'headline' ? HL.size : TYPE.sub.fontSize);
    if (kind === 'headline') while (size > 72 && wrapLines(l.text, size, width) > 2) size -= 4;
    const n = kind === 'headline' ? wrapLines(l.text, size, width) : wrapLines(l.text, size, width, '500', '0em');
    const h = n * size * (kind === 'headline' ? TYPE.hero.lineHeight : TYPE.sub.lineHeight);
    height += h + (i ? gap : 0);
    return { ...l, kind, size, height: h };
  });
  return { items, height };
}
/** The y just below a block that starts at `top`. */
export const blockBottom = (lines: BlockLine[], width = HL.width, gap = HL.gap, top = HL.top) => top + blockLayout(lines, width, gap).height;

/**
 * A headline and its sub (or a lead line and a headline) stacked in normal
 * flow, so a sub always sits below the headline's real bottom edge, with the
 * scrim sized to cover the block.
 */
export const HeadlineBlock: React.FC<{ lines: BlockLine[]; x?: number; top?: number; width?: number; gap?: number; scrim?: boolean }> = ({ lines, x = HL.x, top = HL.top, width = HL.width, gap = HL.gap, scrim = true }) => {
  const c = useColors();
  const key = JSON.stringify(lines.map((l) => [l.text, l.kind, l.size]));
  const layout = useMemo(() => blockLayout(lines, width, gap), [key, width, gap]);
  const frame = useCurrentFrame();
  // When every line leaves, the scrim leaves with the last one.
  const lastExit = lines.every((l) => l.exitAt !== undefined) ? Math.max(...lines.map((l) => l.exitAt!)) : undefined;
  const scrimOpacity = lastExit === undefined ? 1 : leave(frame, lastExit, 7);
  return (
    <>
      {scrim && <HeadlineScrim width={Math.max(1250, x + width + 200)} height={Math.max(460, top + layout.height + 190)} opacity={scrimOpacity} />}
      <div style={{ position: 'absolute', left: x, top, width, display: 'flex', flexDirection: 'column', gap }}>
        {layout.items.map((it, i) => (it.kind === 'headline'
          ? <Headline key={i} text={it.text} at={it.at} exitAt={it.exitAt} size={it.size} color={it.color} />
          : <Kinetic key={i} text={it.text} at={it.at} exitAt={it.exitAt} color={it.color ?? c.muted} style={{ ...TYPE.sub, fontSize: it.size }} />))}
      </div>
    </>
  );
};

/** `#rrggbb` at alpha `a`. */
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

/**
 * A captured modal with the app's treatment: the backdrop dims and blurs in
 * while the card scales up from 0.96 and fades in, and closing reverses it,
 * each over `dur` frames. Nothing pops.
 */
export const ModalLayer: React.FC<{ snap: string; open: number; close?: number; apply?: Apply; dur?: number; dim?: boolean }> = ({ snap, open, close, apply, dur = 7, dim = true }) => {
  const frame = useCurrentFrame();
  if (frame < open || (close !== undefined && frame >= close + dur)) return null;
  return (
    <AppLayer snap={snap} apply={(root, f) => {
      const t = enter(f, open, dur) * (close === undefined ? 1 : leave(f, close, dur));
      const overlay = q(root, '.modal-overlay') ?? (root.firstElementChild as HTMLElement | null);
      if (overlay) {
        overlay.style.backgroundColor = `rgba(0,0,0,${(dim ? 0.6 * t : 0).toFixed(3)})`;
        overlay.style.backdropFilter = dim ? `blur(${(12 * t).toFixed(2)}px)` : 'none';
      }
      const card = q(root, '.modal-card') ?? (overlay?.firstElementChild as HTMLElement | null);
      if (card) { card.style.opacity = String(t); card.style.transform = `scale(${0.96 + 0.04 * t})`; }
      apply?.(root, f);
    }} />
  );
};

export const SceneHeadline: React.FC<{ text: string; at: number; exitAt?: number; size?: number; width?: number; top?: number; color?: string }> = ({ text, at, exitAt, size = 112, width = 1000, top = 70, color }) => (
  <Headline text={text} at={at} exitAt={exitAt} size={size} color={color} style={{ position: 'absolute', left: 96, top, width }} />
);

export const Sub: React.FC<{ text: string; at: number; exitAt?: number; x?: number; y: number; width?: number; color?: string; size?: number }> = ({ text, at, exitAt, x = 96, y, width = 1100, color, size = TYPE.sub.fontSize }) => {
  const c = useColors();
  return <Kinetic text={text} at={at} exitAt={exitAt} color={color ?? c.muted} style={{ ...TYPE.sub, fontSize: size, position: 'absolute', left: x, top: y, width }} />;
};

/** A lane trail sweeping across the frame: carries the cut between scenes. */
export const LaneSweep: React.FC<{ at: number; color: string; y?: number; width: number; height: number; dir?: 1 | -1 }> = ({ at, color, y, width, height, dir = 1 }) => {
  const frame = useCurrentFrame();
  const t = prog(frame, at - 5, 11);
  if (frame < at - 5 || t >= 1) return null;
  const yy = y ?? height * 0.62;
  const d = dir === 1 ? `M ${-width * 0.2} ${yy + 40} C ${width * 0.3} ${yy - 30}, ${width * 0.7} ${yy + 30}, ${width * 1.2} ${yy - 40}` : `M ${width * 1.2} ${yy + 40} C ${width * 0.7} ${yy - 30}, ${width * 0.3} ${yy + 30}, ${-width * 0.2} ${yy - 40}`;
  return <LaneTrails width={width} height={height} lanes={[{ d, color, head: 0.15 + 1.1 * t, tail: 0.55, width: 10, opacity: clamp01(3 * (1 - t)) }]} />;
};

// Apply helpers for captured DOM.
export const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
export const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
export const byText = (root: ParentNode, sel: string, text: string) => qa(root, sel).find((e) => e.textContent?.includes(text)) ?? null;
export const setText = (el: Element | null | undefined, text: string) => { if (el && el.textContent !== text) el.textContent = text; };
