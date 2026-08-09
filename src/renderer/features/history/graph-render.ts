// Draws the commit graph.
//
// Rows are appended, never rebuilt. The previous renderer cleared the list and
// recreated every row on each page load, so scrolling through 20 pages
// rebuilt 42,000 rows' worth of DOM instead of 4,000.
import { el, fragment, icon } from '../../dom/create';
import { hasNote } from '../notes';
import {
  GRAPH_ROW_HEIGHT,
  graphLaneX,
  gutterWidth,
  type GraphRow
} from './graph-layout';

const SVG_NS = 'http://www.w3.org/2000/svg';

function path(d: string, colorIndex: number): SVGPathElement {
  const element = document.createElementNS(SVG_NS, 'path');
  element.setAttribute('d', d);
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke-width', '2');
  element.style.stroke = `var(--graph-lane-${colorIndex})`;
  return element;
}

/** The lane gutter for one row: pass-through lines, edges, and the dot. */
export function buildRowGutter(row: GraphRow, width: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(GRAPH_ROW_HEIGHT));
  svg.classList.add('commit-graph-gutter');

  const midY = GRAPH_ROW_HEIGHT / 2;
  const dotX = graphLaneX(row.lane);

  for (const { lane, color } of row.passLanes) {
    const x = graphLaneX(lane);
    svg.appendChild(path(`M ${x} 0 V ${GRAPH_ROW_HEIGHT}`, color));
  }

  if (row.lineAbove) {
    svg.appendChild(path(`M ${dotX} 0 V ${midY}`, row.color));
  }
  if (row.lineBelow) {
    svg.appendChild(path(`M ${dotX} ${midY} V ${GRAPH_ROW_HEIGHT}`, row.color));
  }

  for (const edge of row.edges) {
    const x = graphLaneX(edge.lane);
    if (edge.type === 'in') {
      // A lane above merges into this commit's dot.
      svg.appendChild(
        path(`M ${x} 0 C ${x} ${midY * 0.8}, ${dotX} ${midY * 0.4}, ${dotX} ${midY}`, edge.color)
      );
    } else {
      // This commit forks out to a parent lane below.
      svg.appendChild(
        path(
          `M ${dotX} ${midY} C ${dotX} ${midY + midY * 0.6}, ${x} ${midY + midY * 0.2}, ${x} ${GRAPH_ROW_HEIGHT}`,
          edge.color
        )
      );
    }
  }

  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', String(dotX));
  dot.setAttribute('cy', String(midY));
  dot.setAttribute('r', '4');
  dot.setAttribute('stroke-width', '1.5');
  dot.style.fill = `var(--graph-lane-${row.color})`;
  dot.style.stroke = 'var(--bg-card)';
  svg.appendChild(dot);

  return svg;
}

/** Number of ref chips shown beside a commit before the rest are elided. */
const MAX_REF_CHIPS = 2;

export function buildCommitRow(row: GraphRow, width: number): HTMLLIElement {
  const { commit } = row;

  const refChips = commit.refs.slice(0, MAX_REF_CHIPS).map((ref) =>
    el('span', {
      className: 'ref-chip',
      // "HEAD -> main" reads better as just the branch name on the chip.
      text: ref.replace(/^HEAD -> /, ''),
      title: ref
    })
  );
  for (const chip of refChips) {
    chip.style.borderColor = `var(--graph-lane-${row.color})`;
  }

  const messageRow = el('div', {
    className: 'commit-graph-msg-row',
    children: [
      ...refChips,
      el('span', { className: 'commit-msg', text: commit.message, title: commit.message }),
      // A marker, not the note itself. Rows are a fixed height so the gutter
      // SVGs tile, and note text is arbitrarily long — reading it is the
      // drawer's job.
      ...(hasNote(commit.hash)
        ? [
            el('span', {
              className: 'commit-note-marker',
              text: '•',
              title: 'This commit carries a note'
            })
          ]
        : [])
    ]
  });

  const meta = el('div', {
    className: 'commit-meta',
    children: [
      el('span', { className: 'commit-author', text: commit.author }),
      el('span', { text: commit.date })
    ]
  });

  return el('li', {
    // Whether the row carries chips decides what its second line can be when
    // the history panel is narrow. A row height fixed at GRAPH_ROW_HEIGHT is
    // what lets the gutter SVGs tile, so the stylesheet cannot make room by
    // growing the row; it drops the author and date instead — but only where a
    // chip has already taken the first line. CSS cannot ask "does this row have
    // chips", so the class answers it here.
    className: refChips.length === 0
      ? 'commit-graph-row'
      : 'commit-graph-row commit-graph-row--tagged',
    // The hash rides on the element; one delegated listener reads it, instead
    // of every row carrying its own closure.
    data: { hash: commit.hash },
    children: [
      buildRowGutter(row, width),
      el('div', { className: 'commit-graph-content', children: [messageRow, meta] })
    ]
  });
}

/** Appends rows to the list in a single DOM operation. */
export function appendRows(list: Element, rows: readonly GraphRow[], maxLanes: number): void {
  const width = gutterWidth(maxLanes);
  list.appendChild(fragment(rows.map((row) => buildCommitRow(row, width))));
}

export function buildEmptyState(message = 'No commits yet'): HTMLLIElement {
  return el('li', { className: 'empty-state', text: message });
}

/**
 * The sentinel an IntersectionObserver watches to load the next page.
 *
 * Replaces a scroll handler that ran on every scroll event and measured
 * scrollHeight each time, forcing layout.
 */
export function buildLoadMoreSentinel(): HTMLLIElement {
  return el('li', {
    className: 'empty-state commit-graph-loader',
    data: { role: 'load-more' },
    children: [icon('progress_activity', 16), el('span', { text: 'Loading more commits…' })]
  });
}
