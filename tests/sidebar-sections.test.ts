// @vitest-environment happy-dom
//
// Collapsing sidebar sections, against the real index.html.
//
// Mounting the actual markup is what makes this worth running: the restore path
// reads `data-section`, and the click path walks from the event target up to
// `.sidebar-section`. Both are assumptions about the template, so a section
// that loses its attribute or gains a wrapper fails here rather than silently
// stopping being collapsible.
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

async function mount() {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  const sections = await import('../src/renderer/ui/sections');
  sections.initCollapsibleSections();
  return sections;
}

function section(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`.sidebar-section[data-section="${name}"]`);
  if (!element) {
    throw new Error(`No sidebar section named ${name}`);
  }
  return element;
}

const toggleOf = (name: string): HTMLElement =>
  section(name).querySelector<HTMLElement>('.section-toggle') as HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
});

describe('collapsible sidebar sections', () => {
  it('gives every sidebar section a name to be remembered under', async () => {
    await mount();

    const named = document.querySelectorAll('.sidebar-section[data-section]');
    const all = document.querySelectorAll('.sidebar .sidebar-section');

    // An unnamed section would collapse but forget, which is worse than not
    // collapsing at all.
    expect(named.length).toBe(all.length);
    expect(named.length).toBeGreaterThanOrEqual(7);
  });

  it('collapses an expanded section when its heading is clicked', async () => {
    const sections = await mount();

    expect(sections.isSectionCollapsed(section('branches'))).toBe(false);
    expect(toggleOf('branches').getAttribute('aria-expanded')).toBe('true');

    toggleOf('branches').click();

    expect(sections.isSectionCollapsed(section('branches'))).toBe(true);
    expect(toggleOf('branches').getAttribute('aria-expanded')).toBe('false');
  });

  it('expands a section that starts collapsed', async () => {
    const sections = await mount();

    expect(sections.isSectionCollapsed(section('stashes'))).toBe(true);

    toggleOf('stashes').click();

    expect(sections.isSectionCollapsed(section('stashes'))).toBe(false);
    expect(toggleOf('stashes').getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses only the section that was clicked', async () => {
    const sections = await mount();

    toggleOf('integrate').click();

    expect(sections.isSectionCollapsed(section('integrate'))).toBe(true);
    expect(sections.isSectionCollapsed(section('branches'))).toBe(false);
  });

  it('opens on a fresh profile with the two sections that declare no default', async () => {
    const sections = await mount();

    // Ten sections all opening at once is what made the sidebar a scroll. The
    // markup decides which start open; this asserts the split rather than the
    // mechanism, so moving a section between the two groups fails here.
    const open = [...document.querySelectorAll<HTMLElement>('.sidebar-section[data-section]')]
      .filter((element) => !sections.isSectionCollapsed(element))
      .map((element) => element.dataset['section']);

    expect(open).toEqual(['branches', 'integrate']);
  });

  it('lets a remembered choice beat the declared default, in both directions', async () => {
    const first = await mount();

    // Opened one that ships collapsed, closed one that ships open.
    toggleOf('stashes').click();
    toggleOf('branches').click();

    const second = await mount();

    expect(second.isSectionCollapsed(section('stashes'))).toBe(false);
    expect(second.isSectionCollapsed(section('branches'))).toBe(true);
    expect(first.isSectionCollapsed(section('tags'))).toBe(true);
  });

  it('leaves the section action button working, not swallowed by the toggle', async () => {
    await mount();

    // "Manage" sits in the header beside the toggle. Nesting it inside would
    // make it collapse the section instead of opening the manager, which is
    // why it is a sibling — assert it is not a descendant of the toggle.
    const manage = document.getElementById('btn-worktree-manage') as HTMLElement;
    expect(manage.closest('.section-toggle')).toBeNull();
    expect(manage.closest('.sidebar-section')).toBe(section('worktrees'));

    // Opened first: this section ships collapsed, and the state to assert is
    // that pressing Manage does not change it, not what it happens to be.
    toggleOf('worktrees').click();

    let collapsedByManage = true;
    manage.addEventListener('click', () => {
      collapsedByManage = section('worktrees').classList.contains('collapsed');
    });
    manage.click();

    expect(collapsedByManage).toBe(false);
  });

  it('restores collapsed sections on the next load', async () => {
    const first = await mount();
    // Already collapsed by default, so open it and shut it again to record a
    // deliberate choice rather than an inherited one.
    toggleOf('safety-net').click();
    toggleOf('safety-net').click();
    expect(first.isSectionCollapsed(section('safety-net'))).toBe(true);

    const second = await mount();

    expect(second.isSectionCollapsed(section('safety-net'))).toBe(true);
    expect(toggleOf('safety-net').getAttribute('aria-expanded')).toBe('false');
    // The others keep their own defaults rather than inheriting the one state.
    expect(second.isSectionCollapsed(section('branches'))).toBe(false);
  });
});
