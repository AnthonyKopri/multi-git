// Collapsible sidebar sections.
//
// The sidebar is a single scrolling column of sections — branches, merge,
// stashes, tags, safety net, worktrees, groups, and the repository summaries.
// Nobody uses all of them at once, and the ones near the bottom were reachable
// only by scrolling past the ones above. Collapsing a section is how you get
// the ones you care about onto one screen.
//
// State is per section and remembered, which is the part that makes it worth
// doing: a layout arranged once should still be there tomorrow.

const STORAGE_PREFIX = 'section_collapsed_';

/** The name a section is remembered under, from `data-section`. */
function sectionName(section: HTMLElement): string | null {
  const name = section.dataset['section'];
  return name === undefined || name === '' ? null : name;
}

function storedCollapsed(name: string): boolean {
  return window.localStorage.getItem(`${STORAGE_PREFIX}${name}`) === 'true';
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
    apply(section, name !== null && storedCollapsed(name));
  }

  for (const container of root.querySelectorAll<HTMLElement>('.sidebar')) {
    container.addEventListener('click', (event) => {
      const toggle = (event.target as HTMLElement | null)?.closest<HTMLElement>('.section-toggle');
      const section = toggle?.closest<HTMLElement>('.sidebar-section');

      if (toggle && section) {
        toggleSection(section);
      }
    });
  }
}
