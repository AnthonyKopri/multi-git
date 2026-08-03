// The Workspace Explorer: a read-only file tree, file viewer, and blame.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { el, fragment } from '../../dom/create';
import { getState, update } from '../../state/store';
import { renderPaneMessage } from '../../ui/busy';
import { buildTreeNode, buildTree, indexTree, sortedChildren } from './file-tree';
import type { TreeNode } from './file-tree';

let ui: Elements;
let showCommit: (hash: string) => Promise<void> = async () => {};

/** Path index for the current tree, so a click can resolve what it hit. */
let treeIndex = new Map<string, TreeNode>();

export function initExplorer(
  elements: Elements,
  hooks: { showCommitDetails: (hash: string) => Promise<void> }
): void {
  ui = elements;
  showCommit = hooks.showCommitDetails;
}

export function lookupTreeNode(path: string): TreeNode | null {
  return treeIndex.get(path) ?? null;
}

export async function loadWorkspaceTree(): Promise<void> {
  if (!getState().activeRepo) {
    return;
  }

  renderPaneMessage(ui.fileTreeContainer, 'Loading files list...', false, 'tree-loading');

  try {
    const data = await api.getFiles();

    const files = [
      ...data.tracked.map((path) => ({ path, untracked: false })),
      ...data.untracked.map((path) => ({ path, untracked: true }))
    ];

    if (files.length === 0) {
      renderPaneMessage(ui.fileTreeContainer, 'No files in repository', false, 'tree-loading');
      return;
    }

    const root = buildTree(files);
    treeIndex = indexTree(root);

    // Only the top level is built now; folders fill in when expanded.
    ui.fileTreeContainer.replaceChildren(
      fragment(sortedChildren(root).map((node) => buildTreeNode(node, 0)))
    );
  } catch (error) {
    if (!isStale(error)) {
      renderPaneMessage(
        ui.fileTreeContainer,
        `Error loading files: ${errorMessage(error)}`,
        true,
        'tree-loading'
      );
    }
  }
}

function setBlameButtonLabel(text: string): void {
  // The button is an icon followed by its label.
  const label = ui.btnToggleBlame.querySelector('span:nth-child(2)');
  if (label) {
    label.textContent = text;
  }
}

export async function openExplorerFile(filePath: string, isUntracked = false): Promise<void> {
  // An untracked file has no history, so blame has nothing to report.
  (ui.btnToggleBlame as HTMLButtonElement).disabled = isUntracked;
  update({ selectedExplorerFile: filePath, blameActive: false });
  setBlameButtonLabel('Show Blame');

  // The heading truncates, so the full path lives in the tooltip.
  ui.explorerFileTitle.textContent = filePath;
  ui.explorerFileTitle.title = filePath;
  renderPaneMessage(ui.explorerFileBody, 'Loading file content...', false, 'file-empty-state');

  try {
    const data = await api.getFileContent(filePath);

    if (data.binary) {
      renderPaneMessage(
        ui.explorerFileBody,
        'This file is binary, so there is nothing to display.',
        false,
        'file-empty-state'
      );
      return;
    }

    const lines = data.content.split('\n');
    ui.explorerFileBody.replaceChildren(
      fragment(
        lines.map((line, index) => {
          const number = el('span', { className: 'diff-line-nums', text: String(index + 1) });
          number.style.width = '40px';
          number.style.paddingRight = '8px';

          return el('div', {
            className: 'blame-line',
            children: [number, el('div', { className: 'blame-code', text: line })]
          });
        })
      )
    );

    if (data.truncated) {
      ui.explorerFileBody.appendChild(
        el('div', {
          className: 'file-empty-state',
          text: 'File is large, so only the first part is shown.'
        })
      );
    }
  } catch (error) {
    if (!isStale(error)) {
      renderPaneMessage(
        ui.explorerFileBody,
        `Error: ${errorMessage(error)}`,
        true,
        'file-empty-state'
      );
    }
  }
}

export async function toggleBlameView(): Promise<void> {
  const filePath = getState().selectedExplorerFile;
  if (!filePath) {
    return;
  }

  const nextActive = !getState().blameActive;
  update({ blameActive: nextActive });

  if (!nextActive) {
    setBlameButtonLabel('Show Blame');
    await openExplorerFile(filePath);
    return;
  }

  setBlameButtonLabel('Hide Blame');
  renderPaneMessage(ui.explorerFileBody, 'Running git blame...', false, 'file-empty-state');

  try {
    const { blame } = await api.getBlame(filePath);

    ui.explorerFileBody.replaceChildren(
      fragment(
        blame.map((line) =>
          el('div', {
            className: 'blame-line',
            children: [
              el('div', {
                className: 'blame-meta',
                children: [
                  el('span', {
                    className: 'blame-hash',
                    text: line.hash.substring(0, 8),
                    title: 'Click to view commit details',
                    // The row carries the hash; one delegated listener on the
                    // body opens the commit.
                    data: { commitHash: line.hash }
                  }),
                  el('span', { className: 'blame-author', text: line.author, title: line.author }),
                  el('span', { className: 'blame-date', text: line.date })
                ]
              }),
              el('div', { className: 'blame-code', text: line.content })
            ]
          })
        )
      )
    );
  } catch (error) {
    if (isStale(error)) {
      return;
    }

    renderPaneMessage(
      ui.explorerFileBody,
      `Blame failed: ${errorMessage(error)}`,
      true,
      'file-empty-state'
    );
    update({ blameActive: false });
    setBlameButtonLabel('Show Blame');
  }
}

/** Opens the commit a blame line points at. */
export async function openBlameCommit(hash: string): Promise<void> {
  await showCommit(hash);
}
