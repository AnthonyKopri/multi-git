// Collapsible sidebar sections.
//
// The sidebar is a single scrolling column of ten sections — branches, merge,
// stashes, tags, safety net, worktrees, groups, and the repository summaries.
// Nobody uses all of them at once, and the ones near the bottom were reachable
// only by scrolling past the ones above. Collapsing a section is how you get
// the ones you care about onto one screen.
//
// Three states, not two, and the distinction is the point: a section has been
// remembered open, remembered shut, or never touched. Only the third consults
// the default, so a preference the user expressed is never overridden by one
// this file assumes. Ten sections all opening at once was that assumption made
// silently, by treating "never touched" as "open".
//
// The default is declared in the markup, as `data-default="collapsed"`, rather
// than as a list of names here. A section added later then says what it does
// on a fresh profile in the same place it says everything else about itself.

const STORAGE_PREFIX = 'section_collapsed_';

/** The name a section is remembered under, from `data-section`. */
function sectionName(section: HTMLElement): string | null {
  const name = section.dataset['section'];
  return name === undefined || name === '' ? null : name;
}

/** What was remembered, or null when this section has never been touched. */
function storedCollapsed(name: string): boolean | null {
  const value = window.localStorage.getItem(`${STORAGE_PREFIX}${name}`);
  return value === null ? null : value === 'true';
}

/** What a section does on a profile that has never touched it. */
function declaredDefault(section: HTMLElement): boolean {
  return section.dataset['default'] === 'collapsed';
}

function persist(name: string, collapsed: boolean): void {
  window.localStorage.setItem(`${STORAGE_PREFIX}${name}`, String(collapsed));
}

/**
 * Applies a state to one section.
 *
 * `aria-expanded` lives on the toggle and the class on the section, because the
 * body being hidden is a fact about the section while being expanded is a fact
 * about the control that expands it.
 */
function apply(section: HTMLElement, collapsed: boolean): void {
  section.classList.toggle('collapsed', collapsed);

  const toggle = section.querySelector<HTMLElement>('.section-toggle');
  toggle?.setAttribute('aria-expanded', String(!collapsed));
}

export function isSectionCollapsed(section: HTMLElement): boolean {
  return section.classList.contains('collapsed');
}

/** Collapses or expands a section and remembers the result. */
export function setSectionCollapsed(section: HTMLElement, collapsed: boolean): void {
  apply(section, collapsed);

  const name = sectionName(section);
  if (name !== null) {
    persist(name, collapsed);
  }
}

export function toggleSection(section: HTMLElement): void {
  setSectionCollapsed(section, !isSectionCollapsed(section));
}

/**
 * Restores every remembered section and makes each header toggle its own.
 *
 * One delegated listener rather than one per section: sections are static
 * markup, but the summary rows added by the Repository hub are not, and a
 * listener on the container keeps both working without a re-wiring step.
 */
export function initCollapsibleSections(root: ParentNode = document): void {
  for (const section of root.querySelectorAll<HTMLElement>('.sidebar-section[data-section]')) {
    const name = sectionName(section);
    const remembered = name === null ? null : storedCollapsed(name);

    apply(section, remembered ?? declaredDefault(section));
  }

  for (const group of root.querySelectorAll<HTMLElement>('.branch-group[data-branch-group]')) {
    applyGroup(group, storedCollapsed(groupKey(group)) ?? false);
  }

  for (const container of root.querySelectorAll<HTMLElement>('.sidebar')) {
    container.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;

      const groupToggle = target?.closest<HTMLElement>('.branch-group-toggle');
      const group = groupToggle?.closest<HTMLElement>('.branch-group');
      if (groupToggle && group) {
        const collapsed = !group.classList.contains('collapsed');
        applyGroup(group, collapsed);
        persist(groupKey(group), collapsed);
        return;
      }

      const toggle = target?.closest<HTMLElement>('.section-toggle');
      const section = toggle?.closest<HTMLElement>('.sidebar-section');

      if (toggle && section) {
        toggleSection(section);
      }
    });
  }

  // Opening and closing animate, but restoring the remembered state on load
  // must not: every folded section would visibly fold itself shut at startup.
  // Two frames, so the restored state has been drawn once before motion is on.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.classList.add('motion-ready'))
  );
}

// ---------- the two branch lists inside Branches ----------

/** Remembered beside the sections, as "branches-local" and "branches-remote". */
function groupKey(group: HTMLElement): string {
  return `branches-${group.dataset['branchGroup'] ?? ''}`;
}

function applyGroup(group: HTMLElement, collapsed: boolean): void {
  group.classList.toggle('collapsed', collapsed);
  group.querySelector<HTMLElement>('.branch-group-toggle')?.setAttribute('aria-expanded', String(!collapsed));
}
