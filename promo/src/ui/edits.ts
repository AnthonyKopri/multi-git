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

/**
 * Hides the SSH Key dropdown's agent and vault status rows. The capture
 * machine had no SSH agent, and its warning rows would steal the shot. This
 * changes the dropdown's layout, so measure-ui measures with it applied.
 */
export function hideAgentRows(root: ParentNode): void {
  const dd = root.querySelector<HTMLElement>('#profile-dropdown');
  if (!dd) return;
  [...dd.children].forEach((el) => {
    const t = el.textContent ?? '';
    if ((el as HTMLElement).classList.contains('agent-row') || /SSH agent|Agent:|Vault:/.test(t)) (el as HTMLElement).style.display = 'none';
  });
}

/**
 * Scrolls the SSH window so its "Auto-select rules" section sits 120 px below
 * the top of its scrolling panel, as scene A shows it. Measured in this state,
 * so the Add Rule button and the rule rows are aimed at where they appear.
 */
export function scrollSshToRules(root: ParentNode): void {
  const h = [...root.querySelectorAll<HTMLElement>('h3')].find((e) => (e.textContent ?? '').includes('Auto-select')) ?? null;
  let p: HTMLElement | null = h?.parentElement ?? null;
  while (p && p !== root && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
  if (p && h && p !== root) p.scrollTop = Math.max(0, h.offsetTop - 120);
}
