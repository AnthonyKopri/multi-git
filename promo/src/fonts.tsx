// Fonts come from public/fonts (Inter, JetBrains Mono) and the material-symbols
// package; every render waits for them. No network.
import React, { useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import { loadFont } from '@remotion/fonts';
import 'material-symbols/outlined.css';
import './ui/app.scoped.css';

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

let loading: Promise<void> | null = null;
const loadAll = () => {
  loading ??= Promise.all([
    loadFont({ family: 'Inter', url: staticFile('fonts/InterVariable-latin.woff2'), weight: '100 900', unicodeRange: LATIN, display: 'block' }),
    loadFont({ family: 'Inter', url: staticFile('fonts/InterVariable-latin-ext.woff2'), weight: '100 900', unicodeRange: LATIN_EXT, display: 'block' }),
    loadFont({ family: 'JetBrains Mono', url: staticFile('fonts/JetBrainsMono-Regular.woff2'), weight: '400', display: 'block' }),
    loadFont({ family: 'JetBrains Mono', url: staticFile('fonts/JetBrainsMono-Medium.woff2'), weight: '500', display: 'block' }),
    loadFont({ family: 'JetBrains Mono', url: staticFile('fonts/JetBrainsMono-Bold.woff2'), weight: '700', display: 'block' }),
  ])
    .then(() => document.fonts.load('24px "Material Symbols Outlined"', 'check'))
    .then(() => document.fonts.ready)
    .then(() => undefined);
  return loading;
};

export const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  const [ready, setReady] = useState(false);
  React.useEffect(() => {
    loadAll()
      .catch((err) => console.error('font load failed', err))
      .finally(() => { setReady(true); continueRender(handle); });
  }, [handle]);
  return ready ? <>{children}</> : null;
};
