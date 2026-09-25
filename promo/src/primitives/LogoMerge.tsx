// The logo drawn on from the lanes: thick centreline strokes (evolvePath) act
// as an SVG mask over the real filled paths from docs/images/multi-git_icon.svg.
// Order: the trunk grows up from the bottom, then forks, the arrowheads pop
// on a spring (beat 2), and the disc scales in behind (beat 3).
import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { evolvePath } from '@remotion/paths';
import { expoOut, pop, prog } from '../lib/anim';
import { useColors } from '../theme';

export const LOGO_LEFT = 'M 787 531 L 594 724 L 668 797 L 728 738 L 730 740 C 730 821, 737 871, 759 925 C 775 962, 798 988, 815 1009 C 835 1034, 860 1058, 882 1076 C 915 1105, 942 1132, 953 1152 C 962 1119, 983 1074, 1013 1030 L 979 994 C 948 966, 920 943, 892 916 C 861 886, 847 847, 847 801 L 847 740 L 849 738 L 910 796 L 982 723 Z';
export const LOGO_RIGHT = 'M 1260 530 L 1065 722 L 1139 797 L 1199 738 L 1201 740 C 1200 789, 1198 824, 1187 865 C 1177 901, 1162 919, 1146 933 L 1052 1026 C 1016 1061, 991 1095, 980 1165 C 974 1190, 972 1203, 972 1217 L 972 1518 L 1090 1518 L 1090 1222 C 1090 1185, 1099 1159, 1126 1122 L 1138 1108 L 1232 1015 C 1285 962, 1308 895, 1317 805 L 1317 740 L 1320 738 L 1381 797 L 1453 724 L 1452 721 Z';
const TRUNK_LINE = 'M 1031 1560 L 1031 1215 C 1031 1130 1080 1080 1130 1030 L 1190 972 C 1245 918 1259 860 1259 790 L 1259 742';
const LEFT_LINE = 'M 1010 1112 C 950 1060 900 1020 860 985 C 820 950 790 900 789 820 L 789 742';
const HEAD_L = '787,512 578,724 668,812 732,750 845,750 910,812 998,723';
const HEAD_R = '1260,510 1050,722 1139,812 1203,750 1315,750 1381,812 1468,724';

/** Where a point of the 2048-unit logo lands on the stage. */
export const logoPoint = (lx: number, ly: number, cx: number, cy: number, size: number) => ({ x: cx + ((lx - 1024) / 2048) * size, y: cy + ((ly - 1024) / 2048) * size });
export const TRUNK_BASE = { x: 1031, y: 1518 };

export const LogoMerge: React.FC<{
  id: string; at: number; cx: number; cy: number; size: number; fast?: boolean; laneLeft?: string; laneRight?: string; glow?: number; still?: boolean;
}> = ({ id, at, cx, cy, size, fast = false, laneLeft, laneRight, glow = 1, still = false }) => {
  const frame = useCurrentFrame();
  const c = useColors();
  const k = fast ? 0.55 : 1;
  const t = still ? 999 : frame - at;
  if (t < 0) return null;
  const trunk = expoOut(prog(t, 0, 14 * k));
  const left = expoOut(prog(t, 7 * k, 10 * k));
  const heads = pop(t, 15 * k, 30, { damping: 12, stiffness: 210, mass: 0.8 });
  const disc = pop(t, 30 * k, 30, { damping: 14, stiffness: 180, mass: 0.9 });
  const mix = prog(t, 4 * k, 22 * k);
  const fillL = interpolateColors(mix, [0, 1], [laneLeft ?? c.cyan, c.logo]);
  const fillR = interpolateColors(mix, [0, 1], [laneRight ?? c.indigo, c.logo]);
  const eT = evolvePath(trunk, TRUNK_LINE), eL = evolvePath(left, LEFT_LINE);
  const mid = `lm-${id}`;
  const flash = Math.max(0, 1 - prog(t, 15 * k, 12));
  return (
    <div style={{ position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, height: size, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: -size * 0.35, borderRadius: '50%', background: `radial-gradient(circle at 50% 50%, ${c.indigo}${Math.round(0x55 * glow * Math.min(1, trunk + flash)).toString(16).padStart(2, '0')} 0%, transparent 60%)` }} />
      <svg width={size} height={size} viewBox="0 0 2048 2048" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <mask id={mid} maskUnits="userSpaceOnUse" x={0} y={0} width={2048} height={2048}>
            <rect x={0} y={0} width={2048} height={2048} fill="black" />
            <path d={TRUNK_LINE} fill="none" stroke="white" strokeWidth={176} strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={eT.strokeDasharray} strokeDashoffset={eT.strokeDashoffset} />
            <path d={LEFT_LINE} fill="none" stroke="white" strokeWidth={176} strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={eL.strokeDasharray} strokeDashoffset={eL.strokeDashoffset} />
            <polygon points={HEAD_L} fill="white" style={{ transformBox: 'fill-box', transformOrigin: '50% 80%', transform: `scale(${heads})` }} />
            <polygon points={HEAD_R} fill="white" style={{ transformBox: 'fill-box', transformOrigin: '50% 80%', transform: `scale(${heads})` }} />
          </mask>
        </defs>
        <circle cx={1024} cy={1024} r={819} fill={c.disc} style={{ transformBox: 'fill-box', transformOrigin: '50% 50%', transform: `scale(${disc})` }} />
        <g mask={`url(#${mid})`}>
          <path d={LOGO_LEFT} fill={fillL} />
          <path d={LOGO_RIGHT} fill={fillR} />
        </g>
      </svg>
    </div>
  );
};
