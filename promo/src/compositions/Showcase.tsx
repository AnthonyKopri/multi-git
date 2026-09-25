// Dev only: every primitive on one stage, for the M4 contact sheet.
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import tui from '../../assets/captures/data/tui.json';
import writes from '../../assets/captures/data/terminal-writes.json';
import copy from '../copy.json';
import { FontGate } from '../fonts';
import { Camera } from '../primitives/Camera';
import { MontageCard } from '../primitives/Card';
import { CornerCounter, SplitFlap } from '../primitives/Counter';
import { Cursor } from '../primitives/Cursor';
import { Grain } from '../primitives/Grain';
import { Headline } from '../primitives/Headline';
import { KeyCombo } from '../primitives/KeyCap';
import { LaneTrails } from '../primitives/LaneTrails';
import { LogoMerge } from '../primitives/LogoMerge';
import { SpellStack } from '../primitives/SpellStack';
import { AnsiScreen, CommandRecords, type LogRecord, type Span } from '../primitives/Terminal';
import { defaultPropsFor } from '../schema';
import { DEFAULT_COLORS, FilmCtx, FONT } from '../theme';
import { AppSnapshot } from '../ui/AppSnapshot';

const Cell: React.FC<{ x: number; y: number; label: string; children: React.ReactNode }> = ({ x, y, label, children }) => (
  <div style={{ position: 'absolute', left: x * 640, top: y * 360, width: 640, height: 360, overflow: 'hidden', borderRight: '1px solid #262e3d', borderBottom: '1px solid #262e3d' }}>
    {children}
    <div style={{ position: 'absolute', left: 12, bottom: 8, fontFamily: FONT.mono, fontSize: 24, color: '#9ca3af' }}>{label}</div>
  </div>
);

export const Showcase: React.FC = () => {
  const frame = useCurrentFrame();
  const props = defaultPropsFor('Promo');
  const ctx = { comp: 'Promo' as const, props, colors: DEFAULT_COLORS, copy: props.copy, width: 1920, height: 1080 };
  const valueAt = (f: number) => (f < 40 ? 0 : Math.min(6, Math.floor((f - 40) / 2) + 1));
  const hero = (f: number) => (f < 70 ? Math.floor(Math.abs(Math.sin(f * 1.7)) * 99) : 45);
  return (
    <FilmCtx.Provider value={ctx}>
      <FontGate>
        <AbsoluteFill style={{ background: DEFAULT_COLORS.background }}>
          <Cell x={0} y={0} label="SpellStack">
            <SpellStack lines={copy.spells.a} at={0} collapseAt={60} box={{ x: 10, y: 10, w: 620 }} fontSize={24} target={{ x: 420, y: 290, w: 180, h: 44 }} />
            <div style={{ position: 'absolute', left: 420, top: 290, width: 180, height: 44, borderRadius: 8, background: '#171b26', border: '1px solid #262e3d' }} />
          </Cell>
          <Cell x={1} y={0} label="Counter">
            <div style={{ position: 'absolute', right: 0, top: 0, width: 640, height: 100 }}><CornerCounter valueAt={valueAt} label={copy.counterLabel} x={20} y={20} accent={frame > 40 && frame < 60} /></div>
            <div style={{ position: 'absolute', left: 190, top: 120 }}><SplitFlap valueAt={hero} size={120} /></div>
          </Cell>
          <Cell x={2} y={0} label="LaneTrails">
            <LaneTrails width={640} height={360} lanes={[
              { d: 'M -40 120 C 200 100, 420 140, 700 110', color: DEFAULT_COLORS.cyan, head: frame / 80, tail: 0.5 },
              { d: 'M -40 230 C 220 250, 430 210, 700 240', color: DEFAULT_COLORS.indigo, head: (frame - 6) / 80, tail: 0.5 },
            ]} />
          </Cell>
          <Cell x={0} y={1} label="LogoMerge">
            <LogoMerge id="show" at={4} cx={320} cy={175} size={300} />
          </Cell>
          <Cell x={1} y={1} label="KeyCap">
            <KeyCombo keys={['Ctrl', 'Alt', 'U']} enterAt={6} pressAt={40} style={{ position: 'absolute', left: 90, top: 120 }} />
          </Cell>
          <Cell x={2} y={1} label="Card">
            <div style={{ position: 'absolute', left: 20, top: 20, transform: 'scale(0.72)', transformOrigin: '0 0' }}>
              <MontageCard q="Undo my last commit?" struck="git reset --soft HEAD~1" lane="cyan" at={20} control={<div className="mg-app" style={{ background: 'transparent' }}><button className="btn btn-text btn-sm" style={{ fontSize: 30 }}><span className="material-symbols-outlined">undo</span> Undo</button></div>} />
            </div>
          </Cell>
          <Cell x={0} y={2} label="Terminal">
            <div style={{ position: 'absolute', left: 8, top: 8, transform: 'scale(0.42)', transformOrigin: '0 0' }}>
              <AnsiScreen lines={(tui as { states: { lines: Span[][] }[] }).states[1].lines} fontSize={24} rows={34} />
            </div>
            <CommandRecords records={(writes as { command: LogRecord }[]).filter((w) => /commit|apply|reset/.test(w.command.argv.join(' '))).slice(0, 3).map((w) => w.command)} at={10} fontSize={24} maxChars={34} style={{ position: 'absolute', left: 330, top: 10 }} />
          </Cell>
          <Cell x={1} y={2} label="Camera + app">
            <Camera width={640} height={360} keys={[{ at: 0, x: 800, y: 500, scale: 0.4 }, { at: 40, x: 1150, y: 250, scale: 1.0, dur: 8 }]}>
              <AppSnapshot snap="workspace-body" width={1600} height={1000} />
            </Camera>
          </Cell>
          <Cell x={2} y={2} label="Headline + Cursor">
            <Headline text="Undo the scary stuff." at={10} size={64} style={{ position: 'absolute', left: 30, top: 60, width: 560 }} />
            <Cursor stops={[{ at: 0, x: 500, y: 300 }, { at: 45, x: 200, y: 230, click: true, ring: { x: 170, y: 215, w: 90, h: 30 } }]} enterAt={0} />
          </Cell>
          <Grain />
        </AbsoluteFill>
      </FontGate>
    </FilmCtx.Provider>
  );
};
