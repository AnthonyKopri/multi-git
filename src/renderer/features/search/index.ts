// Finding commits, and comparing two refs.
//
// Both live in one modal because they answer the same kind of question — "what
// is in here that I have not seen" — and because the result of one is often
// the input to the other.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput } from '../../dom/elements';
import { el, fragment, setHidden } from '../../dom/create';
import { showToast } from '../../ui/toast';
import type { Commit } from '../../../shared/git-types';

let ui: Elements;
let onOpenCommit: (hash: string) => void = () => {};

/** Where the next page starts, and what it is a page of. */
let lastSearch: api.CommitSearchInput = {};
let nextSkip = 0;

const PAGE_SIZE = 50;

export function initSearch(elements: Elements, hooks: { showCommit: (hash: string) => void }): void {
  ui = elements;
  onOpenCommit = hooks.showCommit;
}

function commitRow(commit: Commit): HTMLLIElement {
  return el('li', {
    className: 'recovery-item',
    data: { hash: commit.hash },
    title: 'Open this commit',
    children: [
      el('div', {
        className: 'recovery-item-main',
        children: [
          el('span', { className: 'recovery-label', text: commit.message }),
          el('span', {
            className: 'recovery-meta',
            text: [commit.hash.substring(0, 8), commit.author, commit.date]
              .filter(Boolean)
              .join(' · ')
          })
        ]
      })
    ]
  });
}

function fileRow(entry: { status: string; path: string }): HTMLLIElement {
  return el('li', {
    className: 'recovery-item',
    children: [
      el('div', {
        className: 'recovery-item-main',
        children: [
          el('span', { className: 'recovery-label', text: entry.path }),
          el('span', { className: 'recovery-meta', text: entry.status })
        ]
      })
    ]
  });
}

function renderInto(list: Element, rows: HTMLElement[], emptyMessage: string): void {
  list.replaceChildren(
    rows.length === 0 ? el('li', { className: 'empty-state', text: emptyMessage }) : fragment(rows)
  );
}

function currentFilters(): api.CommitSearchInput {
  const filters: api.CommitSearchInput = { limit: PAGE_SIZE };
  const fields: [keyof api.CommitSearchInput, HTMLElement][] = [
    ['query', ui.searchQuery],
    ['author', ui.searchAuthor],
    ['paths', ui.searchPaths],
    ['since', ui.searchSince],
    ['until', ui.searchUntil]
  ];

  for (const [key, element] of fields) {
    const value = asInput(element).value.trim();
    if (value !== '') {
      (filters as Record<string, unknown>)[key] = value;
    }
  }

  return filters;
}

async function runSearch(append: boolean): Promise<void> {
  const filters = append ? { ...lastSearch, skip: nextSkip } : currentFilters();

  if (!append) {
    lastSearch = filters;
    nextSkip = 0;
    ui.searchSummary.textContent = 'Searching…';
  }

  try {
    const result = await api.searchCommits(filters);
    const rows = result.commits.map(commitRow);

    if (append) {
      ui.searchResults.append(fragment(rows));
    } else {
      renderInto(ui.searchResults, rows, 'Nothing matched those filters');
    }

    nextSkip = (filters.skip ?? 0) + result.commits.length;
    setHidden(ui.btnSearchMore, !result.hasMore);

    ui.searchSummary.textContent = result.hasMore
      ? `Showing the first ${nextSkip} matches.`
      : `${nextSkip} ${nextSkip === 1 ? 'match' : 'matches'}.`;
  } catch (error) {
    if (!isStale(error)) {
      ui.searchSummary.textContent = errorMessage(error, 'The search failed.');
    }
  }
}

async function runCompare(): Promise<void> {
  const base = asInput(ui.compareBase).value.trim();
  const head = asInput(ui.compareHead).value.trim();

  if (base === '' || head === '') {
    ui.compareSummary.textContent = 'Give both a base and a head ref.';
    return;
  }

  ui.compareSummary.textContent = 'Comparing…';

  try {
    const result = await api.compareRefs(base, head);

    ui.compareSummary.textContent =
      `${result.head} is ${result.ahead} ahead and ${result.behind} behind ${result.base}` +
      (result.mergeBase === null
        ? ' (no common ancestor).'
        : `, from ${result.mergeBase.substring(0, 8)}.`);

    renderInto(ui.compareAhead, result.aheadCommits.map(commitRow), 'Nothing only on head');
    renderInto(ui.compareBehind, result.behindCommits.map(commitRow), 'Nothing only on base');
    renderInto(ui.compareFiles, result.files.map(fileRow), 'No changed files');
  } catch (error) {
    if (!isStale(error)) {
      ui.compareSummary.textContent = errorMessage(error, 'The comparison failed.');
    }
  }
}

function showPane(which: 'commits' | 'compare'): void {
  setHidden(ui.searchCommitsPane, which !== 'commits');
  setHidden(ui.searchComparePane, which !== 'compare');
  ui.tabSearchCommits.classList.toggle('active', which === 'commits');
  ui.tabSearchCompare.classList.toggle('active', which === 'compare');
}

export function openSearch(mode: 'commits' | 'compare' = 'commits'): void {
  setHidden(ui.searchModal, false);
  showPane(mode);
  setTimeout(() => asInput(mode === 'commits' ? ui.searchQuery : ui.compareBase).focus(), 20);
}

export function closeSearch(): void {
  setHidden(ui.searchModal, true);
}

/** Prefills the comparison with the current branch against its upstream. */
export function openCompareWith(base: string, head: string): void {
  asInput(ui.compareBase).value = base;
  asInput(ui.compareHead).value = head;
  openSearch('compare');
  void runCompare();
}

export function wireSearch(): void {
  ui.btnRunSearch.addEventListener('click', () => void runSearch(false));
  ui.btnSearchMore.addEventListener('click', () => void runSearch(true));
  ui.btnRunCompare.addEventListener('click', () => void runCompare());

  ui.tabSearchCommits.addEventListener('click', () => showPane('commits'));
  ui.tabSearchCompare.addEventListener('click', () => showPane('compare'));

  for (const field of [ui.searchQuery, ui.searchAuthor, ui.searchPaths, ui.searchSince, ui.searchUntil]) {
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        void runSearch(false);
      }
    });
  }

  for (const field of [ui.compareBase, ui.compareHead]) {
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        void runCompare();
      }
    });
  }

  const openCommit = (target: HTMLElement): void => {
    const hash = target.dataset['hash'];
    if (hash) {
      closeSearch();
      onOpenCommit(hash);
    }
  };

  for (const list of [ui.searchResults, ui.compareAhead, ui.compareBehind]) {
    list.addEventListener('click', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-hash]');
      if (row) {
        openCommit(row);
      }
    });
  }

  ui.btnCloseSearchModal.addEventListener('click', () => closeSearch());
}

/** Copies a hash to the clipboard, which is what most searches end in. */
export async function copyHash(hash: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hash);
    showToast('Commit hash copied.', 'success');
  } catch {
    showToast('Clipboard unavailable.', 'info');
  }
}
