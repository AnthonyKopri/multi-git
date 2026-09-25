// Montage, two lanes, the stinger, the checklist and the end card.
import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import mcp from '../../assets/captures/data/mcp-transcript.json';
import tui from '../../assets/captures/data/tui.json';
import { clamp01, enter, expoOut, lerp, pop, prog } from '../lib/anim';
import { Camera } from '../primitives/Camera';
import { MontageCard } from '../primitives/Card';
import { SplitFlap } from '../primitives/Counter';
import { Cursor } from '../primitives/Cursor';
import { Kinetic } from '../primitives/Headline';
import { KeyCap, KeyCombo } from '../primitives/KeyCap';
import { LaneTrails } from '../primitives/LaneTrails';
import { LogoMerge, logoPoint, TRUNK_BASE } from '../primitives/LogoMerge';
import { AnsiScreen, type Span } from '../primitives/Terminal';
import { FONT, TYPE, useColors, useFilm } from '../theme';
import { SNAP } from '../ui/snapshots.generated';
import { AppLayer, cues, q } from './kit';
import type { SceneProps } from './types';

// ---------------------------------------------------------------- montage --
const SNIPPETS = new Map<string, string>();
const snippet = (snap: string, sel: string, text?: string): string => {
  const key = `${snap}|${sel}|${text ?? ''}`;
  const hit = SNIPPETS.get(key);
  if (hit !== undefined) return hit;
  const tpl = document.createElement('template');
  tpl.innerHTML = SNAP[snap] ?? '';
  const els = [...tpl.content.querySelectorAll<HTMLElement>(sel)];
  const el = text ? els.find((e) => e.textContent?.includes(text)) : els[0];
  SNIPPETS.set(key, el?.outerHTML ?? '');
  return el?.outerHTML ?? '';
};
const Html: React.FC<{ html: string; scale?: number; width?: number; force?: boolean }> = ({ html, scale = 2.45, width = 330, force = true }) => (
  <div className="mg-app" style={{ background: 'transparent', height: 'auto', width, transform: `scale(${scale})`, transformOrigin: 'center center', pointerEvents: 'none' }}>
    <div className={force ? 'mg-force-visible' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
  </div>
);
const Btn: React.FC<{ icon?: string; label: string; kind?: string }> = ({ icon, label, kind = 'btn btn-secondary btn-sm' }) =>
  <button className={kind} type="button">{icon ? <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{icon}</span> : null}<span>{label}</span></button>;

const Control: React.FC<{ id: string }> = ({ id }) => {
  switch (id) {
    case 'undo': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(3.12)' }}><button className="btn btn-text btn-sm" type="button"><span className="material-symbols-outlined" style={{ fontSize: 16 }}>undo</span><span>Undo</span></button></div>;
    case 'stagedRow': return <Html html={snippet('workspace-body', '#staged-files-list li.file-item')} />;
    case 'trash': return <Html html={snippet('workspace-body', '#unstaged-files-list li.file-item', 'src/auth.ts')} />;
    case 'amend': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(3.12)' }}><label className="amend-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" defaultChecked /><span>Amend</span></label></div>;
    case 'remoteBranch': return <Html html={snippet('workspace-body', '.branch-item', 'origin/feature/export') || snippet('workspace-body', 'li', 'origin/feature/export')} />;
    case 'rename': return <Html html={snippet('palette', 'li.palette-item', 'Branch maintenance')} width={420} />;
    case 'deleteBranch': return <Html html={snippet('workspace-body', '.branch-item', 'feature/search') || snippet('workspace-body', 'li', 'feature/search')} />;
    case 'ignore': return <Html html={snippet('workspace-body', '#unstaged-files-list li.file-item', 'token-refresh.md')} />;
    case 'conflict': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(2.47)' }}><div className="conflict-quick-actions" style={{ display: 'flex', gap: 8 }}><Btn icon="arrow_back" label="Use HEAD (Ours)" /><Btn icon="arrow_forward" label="Use Incoming (Theirs)" /></div></div>;
    case 'revert': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(3.12)' }}><Btn icon="undo" label="Revert" /></div>;
    case 'pr': return <Html html={snippet('palette', 'li.palette-item', 'Create a pull request')} width={420} />;
    case 'verified': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(3.12)', display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ color: '#d1d5db', fontSize: 14 }}>feat(auth): add login form</span><span className="badge signature-badge signature-good">Verified</span></div>;
    case 'bisect': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(2.73)', display: 'flex', gap: 8, alignItems: 'center' }}><input className="form-input" readOnly value="npm test" style={{ width: 130 }} /><Btn icon="play_arrow" label="Start bisect" /></div>;
    case 'fetchAll': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(3.12)', display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ color: '#d1d5db', fontSize: 14, fontWeight: 600 }}>Acme</span><Btn icon="sync" label="Fetch all" /></div>;
    case 'deleteMerged': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(2.6)' }}><div className="modal-card modal-small" style={{ padding: 14, position: 'static' }}><h2 style={{ fontSize: 15, marginBottom: 12 }}>Delete merged branches</h2><div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn btn-secondary btn-sm" type="button">Cancel</button><button className="btn btn-danger btn-sm" type="button">Delete</button></div></div></div>;
    case 'search': return <Html html={snippet('palette', 'li.palette-item', 'Search commits')} width={420} />;
    case 'compare': return <Html html={snippet('palette', 'li.palette-item', 'Compare two refs')} width={420} />;
    case 'submodules': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(2.86)', display: 'flex', gap: 10, alignItems: 'center' }}><button className="settings-nav-item hub-tab" type="button" aria-selected="true">Submodules</button><Btn icon="download" label="Update all" /></div>;
    case 'lfs': return <Html html={snippet('hub-lfs', '#hub-tab-lfs')} width={240} scale={3.1} />;
    case 'forceLease': return <div className="mg-app" style={{ background: 'transparent', height: 'auto', transform: 'scale(2.86)' }}><button className="btn btn-danger" type="button">Force Push (with lease)</button></div>;
    default: return null;
  }
};

// The conveyor: each card rides the lane in from the right, is centred and
// highlighted on its beat (tick, counter +1), and leaves on the left. The
// centre card sits at 0.78x; its neighbours are smaller and dimmed to 60%.
const SLOT = [{ x: 0, s: 0.78, o: 1 }, { x: 606, s: 0.6, o: 0.6 }, { x: 1138, s: 0.6, o: 0.6 }];
const smooth = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const slotAt = (d: number) => {
  const a = Math.min(2, Math.abs(d)), i = Math.min(1, Math.floor(a)), u = a - i;
  const p = SLOT[i], q2 = SLOT[i + 1];
  return { x: Math.sign(d) * lerp(p.x, q2.x, u), s: lerp(p.s, q2.s, u), o: lerp(p.o, q2.o, u) };
};
/** The conveyor position (a fractional card index) at `frame`: it steps one card per centre beat. */
const conveyorAt = (frame: number, centres: number[], every: number, end: number) => {
  const move = 10;
  const stops = [...centres, Math.min(end - 15, centres[centres.length - 1] + 15)];
  if (frame < stops[0] - move) return -1 - (stops[0] - move - frame) / every;
  for (let i = 0; i < stops.length; i++) {
    const m = Math.min(move, i === 0 ? move : stops[i] - stops[i - 1]);
    if (frame < stops[i]) return i - 1 + smooth((frame - (stops[i] - m)) / m);
  }
  return stops.length - 1;
};

export const Montage: React.FC<SceneProps> = ({ placed }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width, height } = useFilm();
  const M = copy.montage;
  const cu = cues(placed.def);
  const start = cu.at('start'), sw = cu.at('laneSwitch');
  const cardsDef = placed.def.cards;
  const every = cardsDef?.everyFrames ?? 15;
  const switchAfter = cardsDef?.switchAfter ?? 10;
  const centres = M.cards.map((_, k) => (cardsDef?.beats?.[k] !== undefined ? (cardsDef.beats[k] - 1) * 15 : start + (k + 1) * every));
  const pos = conveyorAt(frame, centres, every, placed.duration);
  const indigo = frame >= sw;
  const laneColor = indigo ? c.indigo : c.cyan;
  const y = 560;
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <Camera keys={[{ at: 0, x: width / 2, y: height / 2, scale: 1 }]} width={width} height={height} drift={0.02} driftFrames={placed.duration} shakes={[sw]}>
        <LaneTrails width={width} height={height} lanes={[
          { d: `M -200 ${y + 20} C 600 ${y - 40}, 1300 ${y + 40}, ${width + 200} ${y - 10}`, color: c.cyan, head: 1.1, tail: 1.2, width: 7, opacity: indigo ? 1 - prog(frame, sw, 8) : enter(frame, 0, 8) },
          { d: `M -200 ${y - 10} C 600 ${y + 40}, 1300 ${y - 40}, ${width + 200} ${y + 20}`, color: c.indigo, head: indigo ? 0.1 + 1.2 * prog(frame, sw - 4, 10) : 0, tail: 1.2, width: 7 },
          { d: `M -200 ${y} C 600 ${y - 30}, 1300 ${y + 30}, ${width + 200} ${y}`, color: indigo ? '#c7d2fe' : '#a5f3fc', head: ((frame % 15) / 15) * 1.2, tail: 0.1, width: 4 },
        ]} />
        {M.cards.map((card, k) => {
          const d = k - pos;
          if (Math.abs(d) > 2.2) return null;
          const sl = slotAt(d);
          const lit = clamp01(1 - Math.abs(d) * 1.6);
          const lane = k < switchAfter ? 'cyan' : 'indigo';
          const accent = lane === 'cyan' ? c.cyan : c.indigo;
          return (
            <div key={k} style={{ position: 'absolute', left: width / 2 + sl.x, top: y, width: 820, height: 470, transform: `translate(-50%, -50%) scale(${sl.s})`, opacity: sl.o, zIndex: Math.round(10 - Math.abs(d) * 3) }}>
              <MontageCard q={card.q} struck={card.struck} lane={lane} at={centres[k]}
                control={<Control id={card.control} />}
                keycap={card.control === 'search' ? <KeyCombo keys={['Ctrl', 'Shift', 'F']} size={26} enterAt={centres[k] - 10} /> : undefined} />
              {lit > 0 && <div style={{ position: 'absolute', inset: 0, borderRadius: 26, border: `3px solid ${accent}`, boxShadow: `0 0 70px ${accent}66`, opacity: lit, pointerEvents: 'none' }} />}
            </div>
          );
        })}
      </Camera>
      <div style={{ position: 'absolute', left: 96, top: 110, ...TYPE.chip, color: laneColor, padding: '8px 18px', borderRadius: 999, background: `${laneColor}1f`, border: `1.5px solid ${laneColor}66`,
        transform: `translateY(${indigo ? (1 - enter(frame, sw, 8)) * -20 : 0}px)` }}>{indigo ? M.chipIndigo : M.chipCyan}</div>
    </AbsoluteFill>
  );
};

// -------------------------------------------------------------- two lanes --
const tuiStates = (tui as { states: { name: string; lines: Span[][] }[] }).states;
const mcpCall = (mcp as { from: string; message: { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> }; result?: { content?: { text: string }[] } } }[]);
const statusResult = (() => {
  const res = mcpCall.find((m) => m.from === 'server' && m.message.id === 3)?.message.result?.content?.[0]?.text;
  try { return JSON.parse(res ?? '{}').data ?? {}; } catch { return {}; }
})();

const cropSpans = (line: Span[], cols: number): Span[] => {
  const out: Span[] = [];
  let n = 0;
  for (const s of line) { if (n >= cols) break; const t = s.text.slice(0, cols - n); n += t.length; out.push({ ...s, text: t }); }
  return out;
};

export const TwoLanes: React.FC<SceneProps> = ({ placed }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width } = useFilm();
  const T2 = copy.twoLanes;
  const cu = cues(placed.def);
  const space = cu.at('space'), j = cu.at('j'), k = cu.at('k'), v = cu.at('v'), s = cu.at('s'), mcpAt = cu.at('mcp'), res = cu.at('mcpResult'), mergeBtn = cu.at('mergeBtn');
  const state = frame >= v ? 'after-v' : frame >= k ? 'after-k' : frame >= j ? 'after-j' : frame >= space ? 'space-menu' : 'normal';
  const shown = tuiStates.find((st) => st.name === state) ?? tuiStates[0];
  const card = { x: 580, y: 20, w: 440, h: 441 };
  const sc = 1.3;
  const call = mcpCall.find((m) => m.message.method === 'tools/call')?.message.params;
  const split = expoOut(prog(frame, 0, 10));
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <LaneTrails width={width} height={1080} lanes={[
        { d: `M -100 ${lerp(620, 592, split)} L ${width + 100} ${lerp(620, 592, split)}`, color: c.cyan, head: 1.2, tail: 1.2, width: 5 },
        { d: `M -100 ${lerp(620, 608, split)} L ${width + 100} ${lerp(620, 608, split)}`, color: c.indigo, head: 1.2, tail: 1.2, width: 5 },
      ]} />
      {/* Cyan: the real merge preview */}
      <div style={{ position: 'absolute', left: 96, top: 64, ...TYPE.chip, color: c.cyan }}>{T2.cyanLabel}</div>
      <Kinetic text={T2.cyanCaption} at={4} style={{ ...TYPE.sub, fontSize: 60, fontWeight: 700, position: 'absolute', left: 96, top: 128, width: 980 }} />
      <div style={{ position: 'absolute', left: 1150, top: 12, width: card.w * sc, height: card.h * sc, overflow: 'hidden', borderRadius: 14, transform: `translateY(${(1 - split) * -30}px)`, opacity: split }}>
        <div style={{ position: 'absolute', left: -card.x * sc, top: -card.y * sc, width: 1600, height: 1000, transform: `scale(${sc})`, transformOrigin: '0 0' }}>
          <AppLayer snap="merge-preview" apply={(root, f) => {
            const overlay = q(root, '.modal-overlay'); if (overlay) overlay.style.background = 'transparent';
            const msg = q(root, '#confirm-message');
            if (msg && !msg.dataset.mg) { msg.innerHTML = msg.innerHTML.replace(/\n?Note:[\s\S]*$/, ''); msg.dataset.mg = '1'; }
            const ok = q(root, '#btn-confirm-ok'); if (ok) ok.style.boxShadow = f >= mergeBtn ? `0 0 0 3px ${c.indigo}, 0 0 26px ${c.indigo}` : '';
          }} />
        </div>
      </div>
      {/* Indigo: the real TUI and a real MCP exchange */}
      <div style={{ position: 'absolute', left: 96, top: 634, ...TYPE.chip, color: c.indigo }}>{T2.indigoLabel}</div>
      <div style={{ position: 'absolute', left: 96, top: 748, width: 1080, height: 290, overflow: 'hidden', borderRadius: 12, border: `1.5px solid ${c.indigo}66` }}>
        <AnsiScreen lines={shown.lines.map((l) => cropSpans(l, 78))} fontSize={23} rows={9} style={{ padding: '10px 14px' }} />
      </div>
      <div style={{ position: 'absolute', left: 1230, top: 748, display: 'flex', gap: 14 }}>
        {[['Space', space], ['j', j], ['k', k], ['v', v], ['s', s]].map(([label, at]) => frame >= (at as number) - 2 ? <KeyCap key={label as string} label={label as string} enterAt={(at as number) - 2} pressAt={at as number} size={32} /> : null)}
      </div>
      {frame >= mcpAt && (
        <div style={{ position: 'absolute', left: 1230, top: 842, width: 594, padding: '14px 20px', borderRadius: 14, background: c.panel, border: `1.5px solid ${c.indigo}66`, fontFamily: FONT.mono, fontSize: 24, lineHeight: 1.45, opacity: enter(frame, mcpAt, 8) }}>
          <div style={{ color: c.muted }}>→ tools/call <span style={{ color: c.text }}>{call?.name}</span></div>
          <div style={{ color: c.spell }}>{`  { "repo": "~/code/acme-api" }`}</div>
          {frame >= res && (
            <div style={{ opacity: enter(frame, res, 6) }}>
              <div style={{ color: c.muted }}>← result</div>
              <div style={{ color: c.emerald }}>{`  { "branch": "${statusResult.branch ?? 'main'}", "ahead": ${statusResult.ahead ?? 2},`}</div>
              <div style={{ color: c.emerald }}>{`    "staged": ${(statusResult.staged ?? []).length ?? 1}, "unstaged": ${(statusResult.unstaged ?? statusResult.modified ?? []).length ?? 2} }`}</div>
            </div>
          )}
        </div>
      )}
      <Kinetic text={T2.indigoCaption} at={mcpAt} style={{ ...TYPE.sub, fontSize: 46, fontWeight: 700, position: 'absolute', left: 96, top: 680, width: 1700 }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- stinger --
export const Stinger: React.FC<SceneProps> = ({ placed }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, comp, width, height } = useFilm();
  const cu = cues(placed.def);
  const land = cu.at('land'), hit = cu.at('hit'), l1 = cu.at('line1');
  const lines = copy.stinger[comp as 'Promo' | 'Promo30' | 'Vertical'] ?? copy.stinger.Promo;
  const total = Number(/(\d+)/.exec(lines[0])?.[1] ?? 45);
  const vertical = height > width;
  const valueAt = (f: number) => (f < land ? 10 + Math.floor(random(`shuffle-${Math.floor(f / 2)}`) * 89) : total);
  const hitIn = frame >= hit;
  const drop = pop(frame, hit, 30, { damping: 11, stiffness: 170, mass: 1 });
  return (
    <AbsoluteFill style={{ background: c.trueBlack }}>
      {!hitIn && (
        <>
          <div style={{ position: 'absolute', left: width / 2 - 220, top: vertical ? 620 : 250 }}><SplitFlap valueAt={valueAt} size={280} /></div>
          <Kinetic text={lines[0]} at={l1} style={{ ...TYPE.hero, fontSize: vertical ? 92 : 80, position: 'absolute', left: 60, width: width - 120, top: vertical ? 1080 : 700, textAlign: 'center' }} />
        </>
      )}
      {hitIn && (
        <>
          <div style={{ position: 'absolute', left: vertical ? width / 2 - 300 : 1060, top: vertical ? 300 : 40, fontFamily: FONT.sans, fontWeight: 800, fontSize: vertical ? 760 : 1000, lineHeight: 1,
            color: c.disc, transform: `translateY(${(1 - drop) * -1150}px)`, textShadow: `0 0 120px ${c.indigo}55` }}>0</div>
          <div style={{ position: 'absolute', left: vertical ? 60 : 96, top: vertical ? 1180 : 400, width: vertical ? width - 120 : 1000, ...TYPE.hero, fontSize: vertical ? 120 : 140, color: c.text,
            transform: `scale(${1.25 - 0.25 * expoOut(prog(frame, hit, 6))})`, transformOrigin: vertical ? 'center' : '0 50%', textAlign: vertical ? 'center' : 'left' }}>{lines[1]}</div>
        </>
      )}
    </AbsoluteFill>
  );
};

// -------------------------------------------------------------- checklist --
const Check: React.FC<{ at: number; size?: number }> = ({ at, size = 48 }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const t = expoOut(prog(frame, at, 8));
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <circle cx={24} cy={24} r={22} fill={`${c.emerald}22`} stroke={c.emerald} strokeWidth={3} opacity={t} />
      <path d="M13 25 L21 33 L36 16" fill="none" stroke={c.emerald} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - t)} />
    </svg>
  );
};
const stripCheck = (s: string) => s.replace(/^✓\s*/, '');

export const Checklist: React.FC<SceneProps> = ({ placed }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy } = useFilm();
  const cu = cues(placed.def);
  const qs = copy.lanes.questions;
  const ans = copy.checklist.answers;
  const qAts = ['q1', 'q2', 'q3', 'q4'].map((k) => cu.at(k));
  const cAts = ['c5', 'c6', 'c7'].map((k) => cu.at(k));
  const rowY = (i: number) => 120 + i * 118;
  return (
    <AbsoluteFill style={{ background: c.background }}>
      {qs.map((qq, i) => {
        const strike = expoOut(prog(frame, qAts[i], 6));
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: 96, top: rowY(i) + 8, fontFamily: FONT.sans, fontWeight: 700, fontSize: 46, color: c.text, opacity: 0.4 }}>
              {qq}
              <div style={{ position: 'absolute', left: 0, top: '54%', height: 5, width: `${strike * 100}%`, background: c.red }} />
            </div>
            {frame >= qAts[i] && (
              <div style={{ position: 'absolute', left: 900, top: rowY(i), display: 'flex', alignItems: 'center', gap: 22, opacity: enter(frame, qAts[i], 8), transform: `translateX(${(1 - enter(frame, qAts[i], 10)) * 60}px)` }}>
                <Check at={qAts[i]} />
                <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 56, letterSpacing: '-0.01em', color: c.text, whiteSpace: 'nowrap' }}>{stripCheck(ans[i])}</span>
              </div>
            )}
          </React.Fragment>
        );
      })}
      {copy.checklist.extras.map((e, i) => frame >= cAts[i] && (
        <div key={i} style={{ position: 'absolute', left: 96, top: rowY(4) + 40 + i * 104, display: 'flex', alignItems: 'center', gap: 22, opacity: enter(frame, cAts[i], 8), transform: `translateX(${(1 - enter(frame, cAts[i], 10)) * 60}px)` }}>
          <Check at={cAts[i]} />
          <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 56, letterSpacing: '-0.01em', color: c.text, whiteSpace: 'nowrap' }}>{stripCheck(e)}</span>
        </div>
      ))}
    </AbsoluteFill>
  );
};

// --------------------------------------------------------------- end card --
export const EndCard: React.FC<SceneProps> = ({ placed, variant }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const { copy, width, height } = useFilm();
  const E = copy.endCard;
  const cu = cues(placed.def);
  const vertical = height > width;
  const still = variant === 'gifOpen';
  const sweep = cu.at('sweep', 0), fuse = cu.at('fuse', 10), wm = cu.at('wordmark', 30), cta = cu.at('cta', 45), click = cu.at('click', 9999);
  const gif = variant === 'gifOpen' || variant === 'gifClose';
  const lc = vertical ? { x: width / 2, y: 600, s: 380 } : { x: width / 2, y: gif ? 330 : 300, s: gif ? 320 : 290 };
  const base = logoPoint(TRUNK_BASE.x, TRUNK_BASE.y + 60, lc.x, lc.y, lc.s);
  const t = (at: number) => (still ? 1 : enter(frame, at, 10));
  const btnRect = vertical ? { x: width / 2 - 200, y: 1150, w: 400, h: 96 } : { x: width / 2 - 470, y: 736, w: 380, h: 96 };
  const pressed = frame >= click && frame < click + 6;
  return (
    <AbsoluteFill style={{ background: c.background }}>
      {!still && frame < fuse + 14 && (
        <LaneTrails width={width} height={height} lanes={[
          { d: `M -150 ${height * 0.25} C ${width * 0.3} ${height * 0.2}, ${base.x - 200} ${base.y + 160}, ${base.x} ${base.y}`, color: c.cyan, head: 0.2 + 0.8 * prog(frame, sweep, fuse - sweep), tail: 0.5, width: 8, opacity: 1 - prog(frame, fuse + 2, 10) },
          { d: `M ${width + 150} ${height * 0.75} C ${width * 0.7} ${height * 0.8}, ${base.x + 200} ${base.y + 160}, ${base.x} ${base.y}`, color: c.indigo, head: 0.2 + 0.8 * prog(frame, sweep, fuse - sweep), tail: 0.5, width: 8, opacity: 1 - prog(frame, fuse + 2, 10) },
        ]} />
      )}
      <LogoMerge id={`end-${placed.section}`} at={fuse} cx={lc.x} cy={lc.y} size={lc.s} fast still={still} />
      <div style={{ position: 'absolute', left: 0, width, top: vertical ? 840 : gif ? 540 : 480, textAlign: 'center', fontFamily: FONT.sans, fontWeight: 700, fontSize: vertical ? 140 : 160, letterSpacing: '-0.03em', color: c.text,
        opacity: t(wm), transform: `scale(${still ? 1 : 1.2 - 0.2 * expoOut(prog(frame, wm, 8))})` }}>{E.wordmark}</div>
      <div style={{ position: 'absolute', left: 60, width: width - 120, top: vertical ? 1020 : gif ? 720 : 660, textAlign: 'center', ...TYPE.sub, fontSize: vertical ? 56 : 52, color: c.muted, opacity: t(wm + 6) }}>{E.tagline}</div>
      {!gif && (
        <div style={{ position: 'absolute', left: 0, width, top: vertical ? 1150 : 736, display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: vertical ? 40 : 44, opacity: t(cta) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 42px', borderRadius: 16, background: pressed ? c.indigoHover : c.indigo, color: '#fff', fontFamily: FONT.sans, fontWeight: 700, fontSize: 44,
            boxShadow: `0 0 ${pressed ? 70 : 40}px ${c.indigo}88`, transform: `scale(${pressed ? 0.96 : 1})` }}>
            {E.cta}<span className="material-symbols-outlined" style={{ fontSize: 46 }}>arrow_forward</span>
          </div>
          <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 40, color: c.text }}>{E.url}</div>
        </div>
      )}
      {gif && <div style={{ position: 'absolute', left: 0, width, top: 830, textAlign: 'center', fontFamily: FONT.mono, fontWeight: 500, fontSize: 48, color: c.text, opacity: t(cta) }}>{E.url}</div>}
      {!gif && <div style={{ position: 'absolute', left: 0, width, top: vertical ? 1420 : 880, textAlign: 'center', ...TYPE.sub, fontSize: 40, color: c.muted, opacity: t(cta + 4) }}>{E.platforms}</div>}
      {click < 9999 && <Cursor keys={[{ at: click - 20, x: width / 2 + 400, y: 1000 }, { at: click - 2, x: btnRect.x + btnRect.w * 0.55, y: btnRect.y + btnRect.h * 0.6, dur: 14 }]} clicks={[click]} enterAt={click - 20} />}
    </AbsoluteFill>
  );
};

export const closingScenes = { Montage, TwoLanes, Stinger, Checklist, EndCard };
