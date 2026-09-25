// Measures where things are inside the captured UI, rendered exactly as the
// film renders it (scoped app CSS, local fonts, 1600x1000 app box), so scenes
// can aim the camera and the spell collapses at real controls.
// Output: src/ui/rects.generated.json  { layer: { selector: {x,y,w,h} } }
// A selector "css::text" means the first match whose text contains `text`;
// "outer >> inner" measures `inner` inside the element `outer` finds. A layer's
// `prep` names a DOM edit from src/ui/edits.ts to apply before measuring.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// import() takes URLs: a bare `D:\...` path is refused on Windows.
const importFile = (...parts) => import(pathToFileURL(path.join(PROMO, ...parts)).href);
const snaps = await importFile('src', 'ui', 'snapshots.generated.ts').catch(() => null);
const SNAP = snaps?.SNAP ?? JSON.parse(/export const SNAP: Record<string, string> = (\{[\s\S]*\});/.exec(fs.readFileSync(path.join(PROMO, 'src', 'ui', 'snapshots.generated.ts'), 'utf8'))[1]);
const EDITS = await importFile('src', 'ui', 'edits.ts');
const css = ['app.scoped.css', 'promo.css'].map((f) => fs.readFileSync(path.join(PROMO, 'src', 'ui', f), 'utf8')).join('\n');
const f = (p) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(PROMO, p)).toString('base64')})`;
const FONTS = `
@font-face{font-family:'Inter';font-weight:100 900;src:${f('public/fonts/InterVariable-latin.woff2')}}
@font-face{font-family:'JetBrains Mono';font-weight:400;src:${f('public/fonts/JetBrainsMono-Regular.woff2')}}
@font-face{font-family:'JetBrains Mono';font-weight:500;src:${f('public/fonts/JetBrainsMono-Medium.woff2')}}
@font-face{font-family:'Material Symbols Outlined';src:${f('node_modules/material-symbols/material-symbols-outlined.woff2')}}
.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;font-feature-settings:'liga'}`;

const PLAN_ROWS = ['rate limiting', 'token helpers', 'highlight matched', 'fixup!', 'API usage'];
const LINES = ['import { expiresSoon }', 'if (expiresSoon(', 'session.refreshedAt =', "console.log('session'", "console.log('refreshed'"];
export const LAYERS = {
  base: { snap: 'workspace-body', place: 'full', measure: ['.navbar', '#repo-segment-wrapper', '#branch-segment-wrapper', '#profile-segment-wrapper', '#profile-segment', '#btn-push', '#sidebar-panel',
    '.sidebar-section[data-section="worktrees"]', '.sidebar-section[data-section="safety-net"]', '#staging-view', '#history-panel', '#commit-history-list',
    '#commit-history-list li.commit-graph-row::docs: add API usage', '#commit-history-list li.commit-graph-row::fixup! feat(search)', '#commit-history-list li.commit-graph-row::highlight matched terms',
    '#commit-history-list li.commit-graph-row::extract the token helpers', '#unstaged-files-list', '#staged-files-list', '#btn-commit', '#btn-undo-commit', '#terminal-panel', '.tab-bar', '#tab-staging', '#tab-diff'] },
  dropdownWork: { snap: 'ssh-dropdown-work', place: ['base', '#profile-segment-wrapper'], prep: 'hideAgentRows', measure: ['#profile-dropdown', '[data-profile-id="work"]', '[data-profile-id="personal"]', '#repo-account-block', '#identity-row', '#profile-segment'] },
  dropdownPersonal: { snap: 'ssh-dropdown-personal', place: ['base', '#profile-segment-wrapper'], prep: 'hideAgentRows', measure: ['#profile-dropdown', '[data-profile-id="work"]', '[data-profile-id="personal"]', '#repo-account-block', '#repo-account-note', '#identity-row'] },
  mismatch: { snap: 'account-mismatch', place: 'full', measure: ['.modal-card', '#btn-confirm-cancel', '#btn-confirm-ok', '#confirm-message'] },
  merge: { snap: 'merge-preview', place: 'full', measure: ['.modal-card', '#btn-confirm-ok', '#confirm-message'] },
  restore: { snap: 'restore-confirm', place: 'full', measure: ['.modal-card', '#btn-confirm-ok'] },
  split: { snap: 'split-confirm', place: 'full', measure: ['.modal-card', '#btn-confirm-ok'] },
  diff: { snap: 'filediff-unselected', sel: '#diff-view', place: ['base', '#staging-view'], measure: ['#diff-view', '#diff-content', ...LINES.map((l) => `[data-line-id]::${l}`), '#diff-selection-bar', '#btn-diff-layout'] },
  diffSelected: { snap: 'filediff-selected', sel: '#diff-view', place: ['base', '#staging-view'], measure: ['#diff-selection-bar', '#btn-diff-stage-selection', '#btn-diff-discard-selection', '#diff-selection-count'] },
  word: { snap: 'worddiff', sel: '#diff-view', place: ['base', '#staging-view'], measure: ['#diff-content', '[data-line-id]::uptime', '.diff-line-deletion', '.diff-line-addition'] },
  image: { snap: 'imagediff', sel: '#diff-view', place: ['base', '#staging-view'], measure: ['#diff-content', 'img'] },
  planner: { snap: 'rebase-planner', place: 'full', measure: ['.modal-card', '#rebase-plan-list', ...PLAN_ROWS.flatMap((r) => [`#rebase-plan-list li::${r}`,
    `#rebase-plan-list li::${r} >> button[title="Move earlier"]`, `#rebase-plan-list li::${r} >> button[title="Move later"]`, `#rebase-plan-list li::${r} >> select.rebase-action`]), '#rebase-autosquash', '#btn-rebase-start'] },
  editStop: { snap: 'rebase-edit-stop', place: 'full', measure: ['.modal-card', '#btn-rebase-split', '#rebase-progress'] },
  recovery: { snap: 'recovery-after-reset', place: 'full', measure: ['.modal-card', '#recovery-points-list', '#recovery-points-list li', '#recovery-points-list li >> button[data-action="restore"]'] },
  safety: { snap: 'safety-net', sel: '.sidebar-section', place: ['base', '.sidebar-section[data-section="safety-net"]'], measure: ['.sidebar-section', '#checkpoint-list', '#trash-list', '#recovery-list', '#recovery-list li'] },
  worktrees: { snap: 'worktrees-section', sel: '.sidebar-section', place: ['base', '.sidebar-section[data-section="worktrees"]'], measure: ['.sidebar-section', '.worktree-item::acme-api', '.worktree-item::login', '.worktree-item::search'] },
  worktreesOpen: { snap: 'workspace-body', place: 'full', prep: 'openWorktrees', measure: ['#sidebar-panel', '.sidebar-section[data-section="worktrees"]', '#worktree-list', '.worktree-item::acme-api', '.worktree-item::login', '.worktree-item::search', '#branch-segment-wrapper'] },
  agent: { snap: 'agent-launch', place: 'full', measure: ['.modal-card', '[data-agent-id="claude"]', '[data-agent-id="codex"]', '[data-agent-id="gemini"]'] },
  palette: { snap: 'palette', place: 'full', measure: ['#palette-modal .modal-card, #palette-modal > div', '#palette-input', '#palette-list'] },
  terminal: { snap: 'terminal-panel', place: 'bottom', measure: ['#terminal-panel', '#terminal-body', '.terminal-line-cmd', '#terminal-show-reads'] },
  sshWindow: { snap: 'ssh-window', place: 'full', prep: 'scrollSshToRules', measure: ['.modal-card', 'h2::Auto-select', 'h3::Auto-select', 'h4::Auto-select', '#btn-add-rule', '#account-rules-list li::github.com/acme/'] },
};

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.MG_CHROME || undefined, args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><head><style>${FONTS}\n${css}\nhtml,body{margin:0;background:#0a0c10}</style></head><body><div id="stage" style="position:relative;width:1600px;height:1000px;overflow:hidden"></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
const out = {};
for (const [name, L] of Object.entries(LAYERS)) {
  let place = { x: 0, y: 0, w: 1600, h: 1000 };
  if (Array.isArray(L.place)) place = out[L.place[0]][L.place[1]] ?? place;
  out[name] = await page.evaluate(({ html, sel, place, placeMode, measure, prep }) => {
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'mg-app';
    box.style.cssText = 'position:absolute;left:0;top:0;width:1600px;height:1000px;background:transparent';
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    let node = sel ? tpl.content.querySelector(sel) : null;
    if (node) {
      const holder = document.createElement('div');
      holder.style.cssText = `position:absolute;left:${place.x}px;top:${place.y}px;width:${place.w}px;${placeMode === 'bottom' ? '' : ''}`;
      holder.appendChild(node);
      box.appendChild(holder);
    } else if (placeMode === 'full') {
      box.innerHTML = html;
    } else {
      const holder = document.createElement('div');
      holder.style.cssText = placeMode === 'bottom' ? 'position:absolute;left:0;bottom:0;width:1600px' : `position:absolute;left:${place.x}px;top:${place.y}px;width:${place.w}px`;
      holder.innerHTML = html;
      box.appendChild(holder);
    }
    stage.appendChild(box);
    if (prep) new Function(`return (${prep})`)()(box);
    const find = (scope, m) => {
      const [css, text] = m.split('::');
      const els = [...scope.querySelectorAll(css)];
      return text ? els.find((e) => e.textContent.includes(text)) : els[0];
    };
    const res = {};
    for (const m of measure) {
      const [outer, inner] = m.split(' >> ');
      const host = find(box, outer);
      const el = inner && host ? find(host, inner) : host;
      if (!el) { res[m] = null; continue; }
      const r = el.getBoundingClientRect();
      // One decimal: scenes zoom up to about 2x, so rounding to whole pixels put rings up to 2 px off.
      const d1 = (v) => Math.round(v * 10) / 10;
      res[m] = { x: d1(r.x), y: d1(r.y), w: d1(r.width), h: d1(r.height) };
    }
    return res;
  }, { html: SNAP[L.snap], sel: L.sel, place, placeMode: Array.isArray(L.place) ? 'at' : L.place, measure: L.measure, prep: L.prep ? EDITS[L.prep].toString() : null });
}
await browser.close();
const file = path.join(PROMO, 'src', 'ui', 'rects.generated.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const missing = Object.entries(out).flatMap(([l, r]) => Object.entries(r).filter(([, v]) => !v || v.w === 0).map(([k]) => `${l}:${k}`));
console.log(`wrote ${path.relative(PROMO, file)}; missing or hidden: ${missing.join(' | ') || 'none'}`);
