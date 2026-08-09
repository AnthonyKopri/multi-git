// @vitest-environment happy-dom
//
// The DOM a commit row is built from.
//
// `graph-layout.test.ts` next door is pure arithmetic and stays that way; this
// is the part that needs a document.
//
// The class asserted here carries information CSS cannot work out for itself.
// A row is a fixed GRAPH_ROW_HEIGHT so the gutter SVGs tile without gaps
// between them, which means a narrow history panel cannot be given more room by
// growing the row — it has to drop something instead. What it can afford to
// drop depends on whether a branch chip has already taken the first line, and
// "does this row have chips" is not a question a selector can ask.
import { describe, expect, it } from 'vitest';

import { buildCommitRow } from '../src/renderer/features/history/graph-render';
import { createLayoutState, layoutCommits } from '../src/renderer/features/history/graph-layout';
import type { Commit } from '../src/shared/git-types';

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    hash: 'aa696a17eadd68fd8d98001239dac9feb2075842',
    parents: [],
    author: 'A. Developer',
    date: '2 hours ago',
    message: 'feat(diff): side-by-side and word highlights',
    refs: [],
    ...overrides
  };
}

/** One row, laid out and built the way the history list builds it. */
function row(source: Commit): HTMLLIElement {
  const [laid] = layoutCommits([source], createLayoutState());
  if (!laid) {
    throw new Error('layoutCommits produced no row');
  }
  return buildCommitRow(laid, 24);
}

describe('buildCommitRow', () => {
  it('marks a row carrying branch or tag chips', () => {
    const tagged = row(commit({ refs: ['HEAD -> main', 'origin/main'] }));

    expect(tagged.classList.contains('commit-graph-row')).toBe(true);
    expect(tagged.classList.contains('commit-graph-row--tagged')).toBe(true);
  });

  it('leaves a row with no refs unmarked, so it keeps its author and date', () => {
    const plain = row(commit());

    expect(plain.classList.contains('commit-graph-row')).toBe(true);
    expect(plain.classList.contains('commit-graph-row--tagged')).toBe(false);
  });

  it('does not mark a row whose refs were all elided', () => {
    // More refs than chips are drawn: the marker has to follow what is in the
    // DOM, not what the commit claimed, or a row with no visible chip would
    // drop its author and date for nothing.
    const many = row(commit({ refs: ['a', 'b', 'c', 'd', 'e'] }));
    const chips = many.querySelectorAll('.ref-chip').length;

    expect(chips).toBeGreaterThan(0);
    expect(many.classList.contains('commit-graph-row--tagged')).toBe(chips > 0);
  });

  it('still carries the hash the delegated click handler reads', () => {
    const built = row(commit({ refs: ['HEAD -> main'] }));

    expect(built.dataset['hash']).toBe('aa696a17eadd68fd8d98001239dac9feb2075842');
  });

  it('keeps the message as text, never as markup', () => {
    // Commit messages come from repositories, which are not trusted input.
    const built = row(commit({ message: '<img src=x onerror=alert(1)>' }));
    const message = built.querySelector('.commit-msg') as HTMLElement;

    expect(message.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(built.querySelector('img')).toBeNull();
  });
});
