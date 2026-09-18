// A section list beside a scrolling pane, kept in step with it.
//
// Extracted from the Settings window when the coding agents window took the
// same layout. The behaviour worth sharing is not the markup — that is three
// elements — but the two details that took a rewrite to get right:
//
//   * A nav click and the scroll spy disagree while a smooth scroll is under
//     way, and a short section at the end of the pane can never reach the top,
//     so the spy would hand the highlight back to the last section instead of
//     the one that was asked for. The spy is held until the scroll settles.
//
//   * `scrollend` is the natural release, and an interrupted or skipped
//     animation may never send one. A timeout releases it either way, because
//     a spy left switched off is a nav that stops responding to scrolling.
import { el, icon } from '../dom/create';

export interface NavSection {
  key: string;
  icon: string;
  title: string;
}

export interface SectionNav {
  /** Draws the list. Sections must already be in the body, or be added next. */
  render(sections: readonly NavSection[]): void;
  /** Scrolls the body to a section and highlights it. */
  jumpTo(key: string): void;
  /** Re-reads the scroll position and moves the highlight. */
  markActive(): void;
}

/** Space left above a section heading the nav scrolls to. */
const SECTION_GAP_PX = 16;

export interface SectionNavOptions {
  nav: HTMLElement;
  /** The scroll container, and the sections' offset parent. */
  body: HTMLElement;
  /** Class the sections carry. Each also needs `data-section`. */
  sectionClass?: string;
  /** Prefix for the heading ids the sections are labelled by. */
  headingIdPrefix?: string;
}

export function createSectionNav(options: SectionNavOptions): SectionNav {
  const { nav, body } = options;
  const sectionClass = options.sectionClass ?? 'settings-section';

  /** The section a nav click is scrolling to, while that scroll is under way. */
  let jumpingTo: string | null = null;

  function sections(): HTMLElement[] {
    return [...body.querySelectorAll<HTMLElement>(`.${sectionClass}`)];
  }

  function setActiveNav(key: string): void {
    for (const button of nav.querySelectorAll<HTMLElement>('.settings-nav-item')) {
      const active = button.dataset['section'] === key;
      button.classList.toggle('active', active);
      if (active) {
        button.setAttribute('aria-current', 'true');
      } else {
        button.removeAttribute('aria-current');
      }
    }
  }

  /** Highlights the section the reader has scrolled to. */
  function markActive(): void {
    if (jumpingTo !== null) {
      return;
    }

    const all = sections();
    if (all.length === 0) {
      return;
    }

    // Scrolled to the end, the last section is the one being read even when it
    // is too short to reach the top of the pane.
    const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    // A section counts as the one being read once its heading is in the top
    // third of the pane, not only once it has reached the very top.
    const line = body.scrollTop + body.clientHeight / 3;
    const current = atEnd
      ? all[all.length - 1]
      : (all.filter((element) => element.offsetTop <= line).pop() ?? all[0]);

    setActiveNav(current?.dataset['section'] ?? '');
  }

  function jumpTo(key: string): void {
    const target = body.querySelector<HTMLElement>(`.${sectionClass}[data-section="${key}"]`);
    if (target === null) {
      return;
    }

    // The body is the sections' offset parent (position: relative), so a
    // section's offsetTop is already a scroll position; the gap keeps the
    // heading off the pane's top edge.
    const top = Math.max(
      0,
      Math.min(target.offsetTop - SECTION_GAP_PX, body.scrollHeight - body.clientHeight)
    );
    setActiveNav(key);

    if (Math.abs(top - body.scrollTop) > 1) {
      jumpingTo = key;
      body.scrollTo({ top, behavior: 'smooth' });

      window.setTimeout(() => {
        if (jumpingTo === key) {
          jumpingTo = null;
        }
      }, 1000);
    }
  }

  nav.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('.settings-nav-item')?.dataset[
      'section'
    ];
    if (key !== undefined) {
      jumpTo(key);
    }
  });

  body.addEventListener('scroll', () => markActive(), { passive: true });
  body.addEventListener('scrollend', () => {
    jumpingTo = null;
  });

  return {
    render(list) {
      nav.replaceChildren(
        ...list.map((info) =>
          el('button', {
            className: 'settings-nav-item',
            data: { section: info.key },
            attrs: { type: 'button' },
            children: [icon(info.icon, 18), el('span', { text: info.title })]
          })
        )
      );
      markActive();
    },
    jumpTo,
    markActive
  };
}
