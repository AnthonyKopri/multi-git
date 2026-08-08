// Renders a structured diff and owns which of its lines are selected.
//
// The plain DiffRenderer next to this one paints a diff. This one also has to
// be pointed at: every changed line is a target the user can pick, and every
// hunk carries its own actions. So each row keeps the id it came from in a
// data attribute, and the container's single delegated listener reads it —
// rather than a closure per line, of which a large diff has tens of thousands.
//
// Rendering stays windowed for the same reason it is in DiffRenderer: a diff
// is only as expensive as the part of it that has been scrolled to.
import { el, fragment } from '../../dom/create';
import { diffWords, pairChangedLines } from './word-diff';
import type { WordSegment } from './word-diff';
import type { DiffFile, DiffHunk, StructuredDiffLine } from '../../../shared/diff-types';

/** Rows rendered before the reader scrolls. Comfortably more than one screen. */
export const INITIAL_WINDOW = 500;

/** Rows appended each time the reader nears the end. */
export const WINDOW_STEP = 1000;

const SCROLL_THRESHOLD_PX = 600;

const LINE_CLASS: Record<StructuredDiffLine['kind'], string> = {
  context: 'diff-line',
  addition: 'diff-line diff-line-addition',
  deletion: 'diff-line diff-line-deletion'
};

const LINE_PREFIX: Record<StructuredDiffLine['kind'], string> = {
  context: ' ',
  addition: '+',
  deletion: '-'
};

/** What each hunk's buttons offer, which depends on where the diff came from. */
export interface HunkActions {
  stage: boolean;
  unstage: boolean;
  discard: boolean;
}

export type DiffLayout = 'unified' | 'split';

/**
 * Builds the content cell, highlighting the words that actually changed.
 *
 * Falls back to plain text when the line has no counterpart — a whole line
 * added or removed has nothing to compare against, and marking all of it as
 * changed would be true but say nothing.
 */
function contentCell(
  line: StructuredDiffLine,
  counterpart: StructuredDiffLine | undefined,
  showPrefix: boolean
): HTMLElement {
  const prefix = showPrefix ? LINE_PREFIX[line.kind] : '';

  if (!counterpart || line.kind === 'context') {
    return el('div', { className: 'diff-line-content', text: prefix + line.content });
  }

  const diff = diffWords(
    line.kind === 'deletion' ? line.content : counterpart.content,
    line.kind === 'deletion' ? counterpart.content : line.content
  );
  const segments: WordSegment[] = line.kind === 'deletion' ? diff.oldSegments : diff.newSegments;

  // Everything changed, or nothing did: a span per token would be noise.
  if (segments.length <= 1) {
    return el('div', { className: 'diff-line-content', text: prefix + line.content });
  }

  return el('div', {
    className: 'diff-line-content',
    children: [
      prefix === '' ? null : document.createTextNode(prefix),
      ...segments.map((segment) =>
        segment.kind === 'same'
          ? document.createTextNode(segment.text)
          : el('span', { className: 'diff-word-changed', text: segment.text })
      )
    ]
  });
}

type Row = { kind: 'hunk'; hunk: DiffHunk } | { kind: 'line'; hunkId: string; line: StructuredDiffLine };

/** Line id to the line it replaced, or that replaced it, across the file. */
function buildCounterparts(file: DiffFile): Map<string, StructuredDiffLine> {
  const byId = new Map<string, StructuredDiffLine>();
  const counterparts = new Map<string, StructuredDiffLine>();

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      byId.set(line.id, line);
    }
  }

  for (const hunk of file.hunks) {
    for (const [id, partnerId] of pairChangedLines(hunk)) {
      const partner = byId.get(partnerId);
      if (partner) {
        counterparts.set(id, partner);
      }
    }
  }

  return counterparts;
}

function flatten(file: DiffFile): Row[] {
  const rows: Row[] = [];

  for (const hunk of file.hunks) {
    rows.push({ kind: 'hunk', hunk });
    for (const line of hunk.lines) {
      rows.push({ kind: 'line', hunkId: hunk.id, line });
    }
  }

  return rows;
}

function actionButton(label: string, glyph: string, action: string, hunkId: string): HTMLButtonElement {
  const button = el('button', {
    className: 'btn btn-secondary btn-sm diff-hunk-action',
    title: label,
    data: { hunkAction: action, hunkId },
    children: [el('span', { className: 'material-symbols-outlined', text: glyph })]
  });

  button.setAttribute('aria-label', `${label}`);
  return button;
}

export class StructuredDiffRenderer {
  private rows: Row[] = [];
  private rendered = 0;
  private readonly selected = new Set<string>();
  /** Line id to its row element, for the rows currently in the DOM. */
  private readonly renderedRows = new Map<string, HTMLElement>();
  /** Line id to the line it replaced, or that replaced it. */
  private counterparts = new Map<string, StructuredDiffLine>();
  private layout: DiffLayout = 'unified';
  private actions: HunkActions = { stage: false, unstage: false, discard: false };
  private readonly onScroll: () => void;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelectionChange: () => void = () => {}
  ) {
    this.onScroll = () => this.maybeExtend();
    this.container.addEventListener('scroll', this.onScroll, { passive: true });
  }

  render(file: DiffFile, actions: HunkActions, layout: DiffLayout = this.layout): void {
    this.rows = flatten(file);
    this.actions = actions;
    this.layout = layout;
    this.counterparts = buildCounterparts(file);
    this.container.classList.toggle('diff-split', layout === 'split');
    this.rendered = 0;
    this.selected.clear();
    this.renderedRows.clear();
    this.container.replaceChildren();
    this.container.scrollTop = 0;

    if (this.rows.length > 0) {
      this.appendUpTo(Math.min(INITIAL_WINDOW, this.rows.length));
    }

    this.onSelectionChange();
  }

  /** Rows not yet in the DOM. */
  get remaining(): number {
    return this.rows.length - this.rendered;
  }

  get selectedLineIds(): string[] {
    return [...this.selected];
  }

  get selectedCount(): number {
    return this.selected.size;
  }

  /** Every changed line id in the diff, whether rendered yet or not. */
  get changeableLineIds(): string[] {
    return this.rows
      .filter((row): row is Extract<Row, { kind: 'line' }> => row.kind === 'line')
      .filter((row) => row.line.kind !== 'context')
      .map((row) => row.line.id);
  }

  lineIdsInHunk(hunkId: string): string[] {
    return this.rows
      .filter((row): row is Extract<Row, { kind: 'line' }> => row.kind === 'line')
      .filter((row) => row.hunkId === hunkId && row.line.kind !== 'context')
      .map((row) => row.line.id);
  }

  toggleLine(lineId: string): void {
    if (this.selected.has(lineId)) {
      this.selected.delete(lineId);
    } else {
      this.selected.add(lineId);
    }

    this.markSelected(lineId);
    this.onSelectionChange();
  }

  /** Selects a whole hunk, or clears it when every line is already selected. */
  toggleHunk(hunkId: string): void {
    const ids = this.lineIdsInHunk(hunkId);
    const allSelected = ids.length > 0 && ids.every((id) => this.selected.has(id));

    for (const id of ids) {
      if (allSelected) {
        this.selected.delete(id);
      } else {
        this.selected.add(id);
      }
      this.markSelected(id);
    }

    this.onSelectionChange();
  }

  clearSelection(): void {
    const previous = [...this.selected];
    this.selected.clear();

    for (const id of previous) {
      this.markSelected(id);
    }

    this.onSelectionChange();
  }

  /** Syncs one row's classes with the selection, if that row is rendered. */
  private markSelected(lineId: string): void {
    // Rows outside the rendered window have no element yet; buildLineRow reads
    // the selection when it eventually creates them.
    const row = this.renderedRows.get(lineId);
    if (!row) {
      return;
    }

    const isSelected = this.selected.has(lineId);
    row.classList.toggle('diff-line-selected', isSelected);
    row.setAttribute('aria-checked', String(isSelected));
  }

  private buildHunkRow(hunk: DiffHunk): HTMLElement {
    const buttons: HTMLElement[] = [];
    if (this.actions.stage) {
      buttons.push(actionButton('Stage this hunk', 'add', 'stage', hunk.id));
    }
    if (this.actions.unstage) {
      buttons.push(actionButton('Unstage this hunk', 'remove', 'unstage', hunk.id));
    }
    if (this.actions.discard) {
      buttons.push(actionButton('Discard this hunk', 'delete', 'discard', hunk.id));
    }

    return el('div', {
      className: 'diff-line diff-line-hunk',
      data: { hunkId: hunk.id },
      children: [
        el('div', {
          className: 'diff-line-nums',
          children: [el('span'), el('span')]
        }),
        el('div', { className: 'diff-line-content', text: hunk.header }),
        buttons.length > 0
          ? el('div', { className: 'diff-hunk-actions', children: buttons })
          : null
      ]
    });
  }

  private buildLineRow(hunkId: string, line: StructuredDiffLine): HTMLElement {
    const selectable = line.kind !== 'context';
    const className =
      LINE_CLASS[line.kind] +
      (selectable ? ' diff-line-selectable' : '') +
      (this.layout === 'split' ? ` diff-side-${line.kind === 'addition' ? 'new' : line.kind === 'deletion' ? 'old' : 'both'}` : '');

    const row = el('div', {
      className,
      data: selectable ? { lineId: line.id, hunkId } : { hunkId },
      children: [
        el('div', {
          className: 'diff-line-nums',
          children: [
            el('span', { text: line.oldLine === null ? '' : String(line.oldLine) }),
            el('span', { text: line.newLine === null ? '' : String(line.newLine) })
          ]
        }),
        contentCell(line, this.counterparts.get(line.id), this.layout === 'unified'),
        line.noNewline
          ? el('div', {
              className: 'diff-line-note',
              text: 'no newline at end of file'
            })
          : null
      ]
    });

    if (selectable) {
      row.setAttribute('role', 'checkbox');
      row.setAttribute('aria-checked', String(this.selected.has(line.id)));
      row.setAttribute('tabindex', '0');
      row.classList.toggle('diff-line-selected', this.selected.has(line.id));
      this.renderedRows.set(line.id, row);
    }

    return row;
  }

  private appendUpTo(target: number): void {
    if (target <= this.rendered) {
      return;
    }

    const slice = this.rows.slice(this.rendered, target);
    this.container.appendChild(
      fragment(
        slice.map((row) =>
          row.kind === 'hunk' ? this.buildHunkRow(row.hunk) : this.buildLineRow(row.hunkId, row.line)
        )
      )
    );
    this.rendered = target;
  }

  private maybeExtend(): void {
    if (this.disposed || this.rendered >= this.rows.length) {
      return;
    }

    const { scrollTop, clientHeight, scrollHeight } = this.container;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD_PX) {
      this.appendUpTo(Math.min(this.rendered + WINDOW_STEP, this.rows.length));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.container.removeEventListener('scroll', this.onScroll);
  }
}
