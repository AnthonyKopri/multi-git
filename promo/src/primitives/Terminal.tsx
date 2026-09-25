// Crisp terminal text: ANSI spans (from the TUI capture) and captured command
// records (argv, cwd, exit code, duration) from the Terminal panel log.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { clamp01 } from '../lib/anim';
import { FONT, useColors } from '../theme';

export interface Span { text: string; fg: string | null; bg: string | null; bold: boolean }
// Map the xterm base palette onto the film's palette so the TUI sits in the film.
const REMAP: Record<string, string> = { '#cd3131': '#ef4444', '#0dbc79': '#10b981', '#e5e510': '#f59e0b', '#2472c8': '#6366f1', '#bc3fbc': '#a78bfa', '#11a8cd': '#06b6d4', '#e5e5e5': '#d1d5db', '#666666': '#6b7280', '#f14c4c': '#f87171', '#23d18b': '#34d399', '#f5f543': '#fbbf24', '#3b8eea': '#818cf8', '#d670d6': '#c4b5fd', '#29b8db': '#22d3ee', '#ffffff': '#f3f4f6' };
const col = (x: string | null) => (x ? REMAP[x.toLowerCase()] ?? x : null);

export const AnsiScreen: React.FC<{ lines: Span[][]; fontSize: number; fg?: string; bg?: string; rows?: number; style?: React.CSSProperties }> = ({ lines, fontSize, fg, bg, rows, style }) => {
  const c = useColors();
  const lh = Math.round(fontSize * 1.28);
  return (
    <div style={{ fontFamily: FONT.mono, fontSize, lineHeight: `${lh}px`, whiteSpace: 'pre', color: fg ?? '#d1d5db', background: bg ?? c.background, ...style }}>
      {lines.slice(0, rows ?? lines.length).map((l, i) => (
        <div key={i} style={{ height: lh }}>
          {l.map((s, j) => (
            <span key={j} style={{ color: col(s.fg) ?? undefined, background: col(s.bg) ?? undefined, fontWeight: s.bold ? 700 : 400 }}>{s.text}</span>
          ))}
        </div>
      ))}
    </div>
  );
};

export interface LogRecord { argv: string[]; cwd: string; exitCode?: number; durationMs?: number }
export const quoteArgv = (argv: string[]) => argv.map((a) => (/[\s"'$`]/.test(a) || a === '' ? `"${a.replace(/(["$`\\])/g, '\\$1')}"` : a)).join(' ');
export const tildify = (p: string) => p.replace(/^\/home\/jane/, '~');

export const CommandRecords: React.FC<{ records: LogRecord[]; at: number; every?: number; fontSize?: number; maxChars?: number; highlight?: number; style?: React.CSSProperties }> = ({ records, at, every = 4, fontSize = 24, maxChars = 96, highlight = -1, style }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  return (
    <div style={{ fontFamily: FONT.mono, fontSize, whiteSpace: 'pre', ...style }}>
      {records.map((r, i) => {
        const t = clamp01((frame - (at + i * every)) / 5);
        if (t <= 0) return null;
        let cmd = quoteArgv(r.argv);
        if (cmd.length > maxChars) cmd = `${cmd.slice(0, maxChars - 1)}…`;
        const shown = cmd.slice(0, Math.ceil(cmd.length * t));
        const ok = (r.exitCode ?? 0) === 0;
        return (
          <div key={i} style={{ padding: `${fontSize * 0.3}px ${fontSize * 0.5}px`, borderRadius: 8, background: i === highlight ? `${c.indigo}26` : 'transparent', outline: i === highlight ? `1.5px solid ${c.indigo}` : undefined }}>
            <div style={{ color: c.text }}><span style={{ color: c.emerald }}>$ </span>{shown}</div>
            <div style={{ color: c.muted, fontSize: Math.max(24, fontSize * 0.8), opacity: t }}>
              {tildify(r.cwd)} · <span style={{ color: ok ? c.emerald : c.red }}>exit {r.exitCode ?? 0}</span> · {r.durationMs ?? 0} ms
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const TerminalWindow: React.FC<{ title: string; width: number; height: number; children: React.ReactNode; accent?: string; style?: React.CSSProperties }> = ({ title, width, height, children, accent, style }) => {
  const c = useColors();
  return (
    <div style={{ width, height, borderRadius: 16, overflow: 'hidden', background: c.background, border: `1.5px solid ${accent ?? c.border}`, boxShadow: '0 30px 80px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', ...style }}>
      <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', background: c.panel, borderBottom: `1px solid ${c.border}`, fontFamily: FONT.mono, fontSize: 24, color: c.muted }}>
        <span className="material-symbols-outlined" style={{ fontSize: 26, color: accent ?? c.muted }}>terminal</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      </div>
      <div style={{ flex: 1, position: 'relative', padding: 22 }}>{children}</div>
    </div>
  );
};

export const Caret: React.FC<{ color?: string; size?: number }> = ({ color, size = 28 }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  return <span style={{ display: 'inline-block', width: size * 0.6, height: size * 1.1, verticalAlign: 'text-bottom', background: color ?? c.text, opacity: Math.floor(frame / 12) % 2 ? 0.15 : 0.9 }} />;
};
