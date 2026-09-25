// Renders captured app DOM under the app's real (scoped) stylesheet. `apply`
// mutates the live nodes for the current frame; it must set every state it
// touches from the frame alone, so any frame renders the same in any order.
import React, { useLayoutEffect, useRef } from 'react';
import { useCurrentFrame } from 'remotion';
import { SNAP } from './snapshots.generated';

export type Apply = (root: HTMLElement, frame: number) => void;

export const AppSnapshot: React.FC<{
  snap: keyof typeof SNAP | string; width: number; height?: number; apply?: Apply; style?: React.CSSProperties; className?: string; frameOverride?: number;
}> = ({ snap, width, height, apply, style, className, frameOverride }) => {
  const frame = useCurrentFrame();
  const f = frameOverride ?? frame;
  const ref = useRef<HTMLDivElement>(null);
  const html = SNAP[snap as string] ?? `<div style="color:red">missing snapshot ${String(snap)}</div>`;
  useLayoutEffect(() => {
    if (ref.current && apply) apply(ref.current, f);
  });
  return (
    <div
      ref={ref}
      className={`mg-app mg-snap ${className ?? ''}`}
      style={{ position: 'relative', width, height, overflow: 'hidden', ...style }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

// Small DOM helpers for apply() functions.
export const $ = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
export const $$ = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
export const setClass = (el: Element | null, cls: string, on: boolean) => el?.classList.toggle(cls, on);
export const setText = (el: Element | null, text: string) => { if (el && el.textContent !== text) el.textContent = text; };
export const setStyle = (el: HTMLElement | null, s: Partial<CSSStyleDeclaration>) => { if (el) Object.assign(el.style, s); };
