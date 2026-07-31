// Recent-repository lists: the header dropdown and the welcome overlay.
import { el, fragment, icon } from '../../dom/create';
import { repoBaseName } from '../../ui/format';

/** Row in the header's repository dropdown. */
export function buildDropdownRow(repoPath: string, isActive: boolean): HTMLLIElement {
  const marker = icon(isActive ? 'check' : 'folder');
  if (isActive) {
    marker.classList.add('item-check');
  }

  const remove = el('button', {
    className: 'btn btn-icon btn-sm',
    title: 'Remove from recents',
    data: { action: 'forget', path: repoPath },
    children: [icon('close', 14)]
  });

  return el('li', {
    className: `dropdown-item${isActive ? ' active' : ''}`,
    data: { action: 'open', path: repoPath },
    children: [
      marker,
      el('span', {
        className: 'dropdown-item-text',
        children: [
          el('span', { className: 'dropdown-item-main', text: repoBaseName(repoPath) }),
          el('span', { className: 'dropdown-item-sub', text: repoPath, title: repoPath })
        ]
      }),
      el('span', { className: 'dropdown-item-actions', children: [remove] })
    ]
  });
}

/** Row in the welcome overlay's recent list. */
export function buildOverlayRow(repoPath: string): HTMLLIElement {
  const remove = el('button', {
    className: 'recent-item-delete',
    title: 'Remove from recents',
    data: { action: 'forget', path: repoPath },
    children: [icon('delete', 16)]
  });

  return el('li', {
    children: [
      el('button', {
        className: 'recent-item-btn',
        data: { action: 'open', path: repoPath },
        children: [el('span', { className: 'recent-item-path', text: repoPath }), remove]
      })
    ]
  });
}

export function renderRecentRepos(
  dropdownList: Element,
  overlayList: Element,
  recentRepos: readonly string[],
  activeRepo: string | null
): void {
  dropdownList.replaceChildren(
    recentRepos.length === 0
      ? el('li', { className: 'dropdown-empty', text: 'No recent repositories' })
      : fragment(recentRepos.map((path) => buildDropdownRow(path, path === activeRepo)))
  );

  overlayList.replaceChildren(
    recentRepos.length === 0
      ? el('li', { className: 'empty-state', text: 'No recently opened repositories' })
      : fragment(recentRepos.map(buildOverlayRow))
  );
}
