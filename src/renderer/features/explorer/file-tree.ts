// The Workspace Explorer's file tree.
//
// Children are built when a folder is first expanded, not up front. The
// previous version rendered every node in the repository immediately —
// thousands of collapsed elements nobody was looking at — so opening the
// Explorer on a large repository cost a long synchronous build.
import { el, fragment, icon } from '../../dom/create';

export interface TreeFile {
  path: string;
  untracked: boolean;
}

export interface TreeNode {
  name: string;
  /** Repository-relative path; '' for the synthetic root. */
  path: string;
  type: 'file' | 'directory';
  untracked: boolean;
  /** Populated for directories, empty for files. */
  children: Map<string, TreeNode>;
}

function newNode(name: string, path: string, type: TreeNode['type'], untracked: boolean): TreeNode {
  return { name, path, type, untracked, children: new Map() };
}

/** Groups flat repository paths into a directory tree. */
export function buildTree(files: readonly TreeFile[]): TreeNode {
  const root = newNode('', '', 'directory', false);

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');

      let child = current.children.get(part);
      if (!child) {
        child = newNode(part, path, isLeaf ? 'file' : 'directory', file.untracked);
        current.children.set(part, child);
      }

      current = child;
    });
  }

  return root;
}

/** Directories first, then files, each alphabetically. */
export function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

const INDENT_PX = 16;
const BASE_PADDING_PX = 8;

function buildRow(node: TreeNode, depth: number): HTMLDivElement {
  const isDirectory = node.type === 'directory';

  const children: HTMLElement[] = [];
  if (isDirectory) {
    children.push(icon('keyboard_arrow_right'));
    children[0]?.classList.add('tree-toggle-arrow');
  }

  const glyph = icon(isDirectory ? 'folder' : 'description');
  glyph.classList.add('tree-icon', isDirectory ? 'folder-icon' : 'file-icon');
  children.push(glyph, el('span', { className: 'tree-label', text: node.name }));

  const row = el('div', {
    className: `tree-item${node.untracked && !isDirectory ? ' tree-item-untracked' : ''}`,
    title: node.path,
    data: { path: node.path, type: node.type, untracked: String(node.untracked) },
    children
  });

  row.style.paddingLeft = `${depth * INDENT_PX + BASE_PADDING_PX}px`;
  return row;
}

/**
 * One node and, for directories, an empty container its children go into on
 * first expansion. `data-loaded` records whether that has happened.
 */
export function buildTreeNode(node: TreeNode, depth: number): HTMLDivElement {
  const container = el('div', { className: 'tree-node' });
  container.appendChild(buildRow(node, depth));

  if (node.type === 'directory') {
    const childrenBox = el('div', { className: 'tree-children hidden', data: { depth: depth + 1 } });
    container.appendChild(childrenBox);
  }

  return container;
}

/**
 * Expands or collapses a directory row, building its children the first time.
 *
 * `lookup` resolves a path back to its node, so this does not need the whole
 * tree threaded through it.
 */
export function toggleDirectory(
  row: HTMLElement,
  lookup: (path: string) => TreeNode | null
): void {
  const container = row.parentElement;
  const childrenBox = container?.querySelector<HTMLElement>(':scope > .tree-children');
  if (!childrenBox) {
    return;
  }

  const expanded = !childrenBox.classList.contains('hidden');
  const arrow = row.querySelector('.tree-toggle-arrow');
  const folder = row.querySelector('.folder-icon');

  if (expanded) {
    childrenBox.classList.add('hidden');
    arrow?.classList.remove('expanded');
    if (folder) {
      folder.textContent = 'folder';
    }
    return;
  }

  if (childrenBox.dataset['loaded'] !== 'true') {
    const node = lookup(row.dataset['path'] ?? '');
    if (node) {
      const depth = Number(childrenBox.dataset['depth'] ?? 0);
      childrenBox.appendChild(
        fragment(sortedChildren(node).map((child) => buildTreeNode(child, depth)))
      );
    }
    childrenBox.dataset['loaded'] = 'true';
  }

  childrenBox.classList.remove('hidden');
  arrow?.classList.add('expanded');
  if (folder) {
    folder.textContent = 'folder_open';
  }
}

/** Index from path to node, so a click can find what it refers to. */
export function indexTree(root: TreeNode): Map<string, TreeNode> {
  const index = new Map<string, TreeNode>();

  const walk = (node: TreeNode): void => {
    if (node.path !== '') {
      index.set(node.path, node);
    }
    for (const child of node.children.values()) {
      walk(child);
    }
  };

  walk(root);
  return index;
}
