export type Mode = 'NORMAL' | 'INPUT' | 'SELECT';
export interface Navigation { index: number; pane: number; mode: Mode; prefix: '' | 'g' | 'window' | 'leader'; selected: number[] }
export const initialNavigation = (): Navigation => ({ index: 0, pane: 0, mode: 'NORMAL', prefix: '', selected: [] });
export const leaderBindings: Record<string, string> = {
  r: 'repositories', b: 'branches', a: 'accounts', f: 'fetch', p: 'pull', P: 'push', A: 'auto-pull',
  c: 'commit', w: 'worktrees', s: 'settings', u: 'recovery', o: 'operations'
};
export function validateBindings(bindings: Record<string, string>): string | null {
  const actions = new Set<string>();
  for (const [key, action] of Object.entries(bindings)) {
    if (!/^[a-zA-Z0-9]$/.test(key)) return 'Leader keys must be one letter or digit.';
    if (!Object.values(leaderBindings).includes(action)) return `Unknown action: ${action}`;
    if (actions.has(action)) return `Two keys are assigned to ${action}.`;
    actions.add(action);
  }
  if (actions.size !== Object.keys(leaderBindings).length) return 'Keep a binding for every leader action.';
  return null;
}
export function navigate(state: Navigation, key: string, count: number, page: number, bindings = leaderBindings): { state: Navigation; action?: string } {
  const next = { ...state };
  if (key === 'escape') return { state: { ...next, mode: 'NORMAL', prefix: '', selected: [] }, action: state.mode === 'INPUT' || state.prefix || state.mode === 'SELECT' ? undefined : 'back' };
  if (state.mode === 'INPUT') return { state: next };
  if (state.prefix === 'leader') return { state: { ...next, prefix: '' }, action: bindings[key] };
  if (state.prefix === 'window') {
    next.prefix = '';
    if ('hjkl'.includes(key)) next.pane = Math.max(0, Math.min(2, next.pane + ('hl'.includes(key) ? (key === 'h' ? -1 : 1) : (key === 'k' ? -1 : 1))));
    return { state: next };
  }
  if (state.prefix === 'g') { next.prefix = ''; if (key === 'g') next.index = 0; }
  else if (key === 'g') next.prefix = 'g';
  else if (key === ' ') next.prefix = 'leader';
  else if (key === 'ctrl+w') next.prefix = 'window';
  else if (key === 'j' || key === 'down') next.index++;
  else if (key === 'k' || key === 'up') next.index--;
  else if (key === 'G' || key === 'end') next.index = count - 1;
  else if (key === 'home') next.index = 0;
  else if (key === 'ctrl+d' || key === 'pagedown') next.index += Math.max(1, Math.floor(page / 2));
  else if (key === 'ctrl+u' || key === 'pageup') next.index -= Math.max(1, Math.floor(page / 2));
  else if (key === 'tab') next.pane = (next.pane + 1) % 3;
  else if (key === 'shift+tab') next.pane = (next.pane + 2) % 3;
  else if (key === 'v') { next.mode = state.mode === 'SELECT' ? 'NORMAL' : 'SELECT'; next.selected = state.mode === 'SELECT' ? [] : [state.index]; }
  else return { state: next, action: ({ ':': 'palette', '/': 'search', '?': 'help', enter: 'open', l: 'open', right: 'open', h: 'back', left: 'back', s: 'stage', u: 'unstage', n: 'next-match', N: 'previous-match', q: 'back', f5: 'refresh' } as Record<string, string>)[key] };
  next.index = Math.max(0, Math.min(Math.max(0, count - 1), next.index));
  if (next.mode === 'SELECT' && !next.selected.includes(next.index)) next.selected = [...next.selected, next.index];
  return { state: next };
}

/** Treat repository text as text, never as terminal control sequences. */
export function terminalText(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '  ');
}
