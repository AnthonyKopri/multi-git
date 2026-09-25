// Converts `tmux capture-pane -p -e` output (text with SGR escapes) into
// lines of {text, fg, bg, bold} spans with colours as hex (xterm palette).
const BASE16 = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
function xterm256(n) {
  if (n < 16) return BASE16[n];
  if (n < 232) {
    const v = [0, 95, 135, 175, 215, 255];
    const i = n - 16;
    return '#' + [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((k) => v[k].toString(16).padStart(2, '0')).join('');
  }
  const g = (8 + (n - 232) * 10).toString(16).padStart(2, '0');
  return `#${g}${g}${g}`;
}
const rgb = (r, g, b) => '#' + [r, g, b].map((k) => Number(k).toString(16).padStart(2, '0')).join('');

export function ansiToSpans(input) {
  const lines = [];
  const st = { fg: null, bg: null, bold: false, reverse: false };
  for (const raw of input.replace(/\r/g, '').split('\n')) {
    const spans = [];
    let text = '';
    const push = () => {
      if (!text) return;
      const fg = st.reverse ? (st.bg ?? '#0a0c10') : st.fg;
      const bg = st.reverse ? (st.fg ?? '#e5e5e5') : st.bg;
      const last = spans[spans.length - 1];
      if (last && last.fg === fg && last.bg === bg && last.bold === st.bold) last.text += text;
      else spans.push({ text, fg, bg, bold: st.bold });
      text = '';
    };
    const re = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]|([^\x1b]+)/g;
    let m;
    while ((m = re.exec(raw))) {
      if (m[2] !== undefined) { text += m[2]; continue; }
      if (m[1] === undefined) continue; // non-SGR escape: ignore
      push();
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) Object.assign(st, { fg: null, bg: null, bold: false, reverse: false });
        else if (c === 1) st.bold = true;
        else if (c === 22) st.bold = false;
        else if (c === 7) st.reverse = true;
        else if (c === 27) st.reverse = false;
        else if (c >= 30 && c <= 37) st.fg = BASE16[c - 30];
        else if (c >= 90 && c <= 97) st.fg = BASE16[c - 90 + 8];
        else if (c >= 40 && c <= 47) st.bg = BASE16[c - 40];
        else if (c >= 100 && c <= 107) st.bg = BASE16[c - 100 + 8];
        else if (c === 39) st.fg = null;
        else if (c === 49) st.bg = null;
        else if ((c === 38 || c === 48) && codes[i + 1] === 5) { const col = xterm256(codes[i + 2]); if (c === 38) st.fg = col; else st.bg = col; i += 2; }
        else if ((c === 38 || c === 48) && codes[i + 1] === 2) { const col = rgb(codes[i + 2], codes[i + 3], codes[i + 4]); if (c === 38) st.fg = col; else st.bg = col; i += 4; }
      }
    }
    push();
    lines.push(spans);
  }
  while (lines.length && lines[lines.length - 1].every((s) => !s.text.trim() && !s.bg)) lines.pop();
  return lines;
}
