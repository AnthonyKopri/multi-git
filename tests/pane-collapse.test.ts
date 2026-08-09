// @vitest-environment happy-dom
//
// Collapsing the two outer panels, against the real index.html.
//
// The behaviour worth pinning is not that a class gets toggled — it is that
// after collapsing there is still something on screen that says how to get the
// panel back, and that the state survives a reload. A panel that can be hidden
// with no visible way to restore it is the failure mode this feature exists to
// avoid, so the strip and its labels are asserted rather than assumed.
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

async function mount() {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  document.body.className = '';

  const panes = await import('../src/renderer/ui/panes');
  panes.initPanes();
  return panes;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('collapsing a side panel', () => {
  it('starts with both panels showing and neither strip visible', async () => {
    await mount();

    expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    expect(document.body.classList.contains('history-collapsed')).toBe(false);
    expect($('btn-toggle-sidebar').getAttribute('aria-expanded')).toBe('true');
    expect($('btn-toggle-history').getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses from the header button and leaves a strip that reopens it', async () => {
    const panes = await mount();

    $('btn-toggle-sidebar').click();

    expect(panes.isSideCollapsed('sidebar')).toBe(true);
    expect(document.body.classList.contains('sidebar-collapsed')).toBe(true);

    // The strip is the only affordance left, so it has to say what it does.
    const reveal = $('sidebar-reveal');
    expect(reveal.getAttribute('aria-expanded')).toBe('false');
    expect(reveal.title).toContain('Show branches panel');
    expect(reveal.title).toContain('Ctrl+B');

    reveal.click();
    expect(panes.isSideCollapsed('sidebar')).toBe(false);
    expect(reveal.getAttribute('aria-expanded')).toBe('true');
  });

  it('flips the header button label so it never lies about what it will do', async () => {
    await mount();
    const toggle = $('btn-toggle-sidebar');

    expect(toggle.title).toContain('Hide branches panel');

    toggle.click();
    expect(toggle.title).toContain('Show branches panel');
    expect(toggle.getAttribute('aria-label')).toBe('Show branches panel');
  });

  it('keeps the two sides independent', async () => {
    const panes = await mount();

    panes.toggleSide('history');

    expect(panes.isSideCollapsed('history')).toBe(true);
    expect(panes.isSideCollapsed('sidebar')).toBe(false);
    expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
  });

  it('restores a collapsed side on the next load', async () => {
    const first = await mount();
    first.toggleSide('history');

    // A fresh mount is the next launch: nothing carries over but storage.
    const second = await mount();

    expect(second.isSideCollapsed('history')).toBe(true);
    expect($('history-reveal').getAttribute('aria-expanded')).toBe('false');
    expect($('btn-toggle-history').getAttribute('aria-expanded')).toBe('false');
  });

  it('gives the remaining panel back the width a collapsed sibling was holding', async () => {
    // A sidebar the user dragged to 500px, in a window too narrow to honour it
    // while the history panel is also on screen. Its cap is
    // `available - reserve`, and `available` counts the history panel's width —
    // so it is pinned below what was asked for.
    window.localStorage.setItem('pane_size_sidebar', '500');
    const panes = await mount();

    window.innerWidth = 900;
    window.dispatchEvent(new Event('resize'));
    const withBoth = parseFloat(document.documentElement.style.getPropertyValue('--sidebar-width'));
    expect(withBoth).toBeLessThan(500);

    // Collapsing the other side is exactly the space that was missing, so the
    // width the user actually chose comes back.
    panes.toggleSide('history');
    const withHistoryGone = parseFloat(
      document.documentElement.style.getPropertyValue('--sidebar-width')
    );

    expect(withHistoryGone).toBe(500);
  });
});
