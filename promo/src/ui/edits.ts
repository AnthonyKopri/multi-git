// DOM edits to captured app layers, shared by the scenes and by
// scripts/measure-ui.mjs (which measures the edited layout). Plain DOM, no
// imports, so Node can load this file directly.

/** Expands the sidebar's Worktrees section and scrolls the sidebar down to it, as the app does. */
export function openWorktrees(root: ParentNode): void {
  const section = root.querySelector<HTMLElement>('.sidebar-section[data-section="worktrees"]');
  if (!section) return;
  section.classList.remove('collapsed');
  section.querySelector('.section-toggle')?.setAttribute('aria-expanded', 'true');
  const sidebar = root.querySelector<HTMLElement>('#sidebar-panel');
  if (sidebar) sidebar.scrollTop = sidebar.scrollHeight;
}
