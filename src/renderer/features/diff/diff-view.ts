// Renders a unified diff.
//
// Rendered in windows rather than all at once. Each line is four DOM nodes, so
// a 50,000-line diff was 200,000 nodes built in one synchronous loop, which
// froze the UI for seconds. Now an initial window renders immediately and more
// is appended as the reader scrolls, so time-to-first-paint no longer depends
// on the size of the diff.
import { el, fragment } from '../../dom/create';
import type { DiffLine } from '../../../shared/git-types';

/** Lines rendered before the reader scrolls. Comfortably more than one screen. */
export const INITIAL_WINDOW = 500;

/** Lines appended each time the reader nears the end. */
export const WINDOW_STEP = 1000;

/** How close to the bottom counts as "nearing the end", in pixels. */
const SCROLL_THRESHOLD_PX = 600;

const LINE_CLASS: Record<DiffLine['type'], string> = {
  hunk: 'diff-line diff-line-hunk',
  addition: 'diff-line diff-line-addition',
  deletion: 'diff-line diff-line-deletion',
  normal: 'diff-line'
};

/** The single character git puts in front of each line. */
const LINE_PREFIX: Record<DiffLine['type'], string> = {
  hunk: '',
  addition: '+',
  deletion: '-',
  normal: ' '
};

function buildLine(line: DiffLine): HTMLDivElement {
  return el('div', {
    className: LINE_CLASS[line.type],
    children: [
      el('div', {
        className: 'diff-line-nums',
        children: [
          el('span', { text: line.oldLine === null ? '' : String(line.oldLine) }),
          el('span', { text: line.newLine === null ? '' : String(line.newLine) })
        ]
      }),
      el('div', {
        className: 'diff-line-content',
        text: line.type === 'hunk' ? line.content : LINE_PREFIX[line.type] + line.content
      })
    ]
  });
}

/**
 * Owns one diff rendering, including its scroll listener.
 *
 * Call `dispose` before rendering a different diff, so the previous
 * listener does not keep appending into a container it no longer owns.
 */
export class DiffRenderer {
  private lines: readonly DiffLine[] = [];
  private rendered = 0;
  private readonly onScroll: () => void;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.onScroll = () => this.maybeExtend();
    this.container.addEventListener('scroll', this.onScroll, { passive: true });
  }

  render(lines: readonly DiffLine[]): void {
    this.lines = lines;
    this.rendered = 0;
    this.container.replaceChildren();
    this.container.scrollTop = 0;

    if (lines.length === 0) {
      return;
    }

    this.appendUpTo(Math.min(INITIAL_WINDOW, lines.length));
  }

  /** Lines not yet in the DOM. Exposed so the UI can say so. */
  get remaining(): number {
    return this.lines.length - this.rendered;
  }

  private appendUpTo(target: number): void {
    if (target <= this.rendered) {
      return;
    }

    const slice = this.lines.slice(this.rendered, target);
    this.container.appendChild(fragment(slice.map(buildLine)));
    this.rendered = target;
  }

  private maybeExtend(): void {
    if (this.disposed || this.rendered >= this.lines.length) {
      return;
    }

    const { scrollTop, clientHeight, scrollHeight } = this.container;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD_PX) {
      this.appendUpTo(Math.min(this.rendered + WINDOW_STEP, this.lines.length));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.container.removeEventListener('scroll', this.onScroll);
  }
}
