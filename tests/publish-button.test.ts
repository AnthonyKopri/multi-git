// @vitest-environment happy-dom
//
// The Push/Publish button against the real index.html, and the wiring that
// keeps it honest.
//
// `pushButtonState` is unit-tested on its own; what is left to protect is
// everything around it. The button only ever changes because the store's
// `status` or `origin` changed, so a caller that mutates a remote without
// telling the store leaves the toolbar showing the state from before — which
// is exactly what the Remotes tab used to do.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { OriginResponse, StatusResponse } from '../src/shared/api-types';
import type { RemoteInfo } from '../src/shared/remote-types';

const repo = vi.hoisted(() => ({
  refreshOrigin: vi.fn(async () => {}),
  renderRemoteProtocolButton: vi.fn(),
  openRepository: vi.fn(async () => {}),
  renderRepoHeader: vi.fn(),
  renderRepoLists: vi.fn(),
  pickFolderPath: vi.fn(async () => '')
}));

/** The owner the remotes feature registers, so a test can render its panel. */
const hub = vi.hoisted(() => ({
  owner: null as { render: (panel: HTMLElement) => Promise<void> } | null
}));

const endpoints = vi.hoisted(() => ({
  getRemotes: vi.fn(async () => ({ success: true, remotes: [] as RemoteInfo[] })),
  removeRemote: vi.fn(async () => ({ success: true })),
  getOrigin: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  fetchRemote: vi.fn(),
  saveAppSettings: vi.fn(async () => ({ success: true, config: {}, warning: null }))
}));

const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => ({ confirmed: true })) }));

vi.mock('../src/renderer/features/repo', () => repo);
vi.mock('../src/renderer/features/repo-hub', () => ({
  registerHubTab: (_tab: string, owner: { render: (panel: HTMLElement) => Promise<void> }) => {
    hub.owner = owner;
  }
}));
vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/dialogs', () => dialogs);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));

type Store = typeof import('../src/renderer/state/store');

async function mount(): Promise<{ store: Store }> {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  vi.clearAllMocks();
  hub.owner = null;
  endpoints.getRemotes.mockResolvedValue({ success: true, remotes: [] });

  const { resolveElements } = await import('../src/renderer/dom/elements');
  const store = (await import('../src/renderer/state/store')) as Store;
  const sync = await import('../src/renderer/features/sync');
  const remotes = await import('../src/renderer/features/remotes');

  const ui = resolveElements();
  sync.initSync(ui, async () => {});
  remotes.initRemotes(ui);

  return { store };
}

function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    success: true,
    branch: 'main',
    tracking: '',
    ahead: 0,
    behind: 0,
    detached: false,
    noCommits: false,
    staged: [],
    unstaged: [],
    conflicts: [],
    isMerging: false,
    isRebasing: false,
    ...overrides
  };
}

const origin: OriginResponse = {
  success: true,
  remoteUrl: 'git@github.com:owner/repo.git',
  protocol: 'ssh',
  host: 'github.com',
  canToggle: true,
  suggestedUrl: 'https://github.com/owner/repo.git'
};

const button = (): HTMLButtonElement => document.getElementById('btn-push') as HTMLButtonElement;
const label = (): HTMLElement => document.getElementById('push-label') as HTMLElement;
const glyph = (): HTMLElement =>
  button().querySelector('.material-symbols-outlined') as HTMLElement;

describe('the Push button', () => {
  let store: Store;

  beforeEach(async () => {
    ({ store } = await mount());
  });

  it('starts as Push, with no label, before a repository is open', () => {
    expect(button().classList.contains('btn-publish')).toBe(false);
    expect(label().classList.contains('hidden')).toBe(true);
    expect(glyph().textContent).toBe('upload');
  });

  it('becomes Publish when an origin appears for a branch with no upstream', () => {
    // The case the Remotes tab used to leave stale: the branch was always
    // untracked, and it is the origin arriving that changes the answer.
    store.update({ status: status() });
    expect(button().classList.contains('btn-publish')).toBe(false);

    store.update({ origin });

    expect(button().classList.contains('btn-publish')).toBe(true);
    expect(label().textContent).toBe('Publish');
    expect(label().classList.contains('hidden')).toBe(false);
    expect(glyph().textContent).toBe('cloud_upload');
    expect(button().getAttribute('aria-label')).toBe('Publish main');
    expect(button().disabled).toBe(false);
  });

  it('goes back to Push once the branch is tracking one', () => {
    store.update({ status: status(), origin });
    expect(button().classList.contains('btn-publish')).toBe(true);

    store.update({ status: status({ tracking: 'origin/main', ahead: 1 }) });

    expect(button().classList.contains('btn-publish')).toBe(false);
    expect(label().classList.contains('hidden')).toBe(true);
    expect(glyph().textContent).toBe('upload');
    expect(button().title).toBe('Push');
  });

  it('reverts to Push when the origin is taken away', () => {
    store.update({ status: status(), origin });
    expect(button().classList.contains('btn-publish')).toBe(true);

    store.update({ origin: null });

    expect(button().classList.contains('btn-publish')).toBe(false);
  });

  it('offers Publish but disables it until there is a commit to send', () => {
    store.update({ status: status({ noCommits: true }), origin });

    expect(button().classList.contains('btn-publish')).toBe(true);
    expect(button().disabled).toBe(true);
    expect(button().title).toMatch(/first commit/i);
  });
});

describe('the Remotes tab', () => {
  let store: Store;

  async function renderRemotesPanel(list: RemoteInfo[]): Promise<void> {
    endpoints.getRemotes.mockResolvedValue({ success: true, remotes: list });
    store.update({ activeRepo: 'D:\\work\\app' });

    const panel = document.getElementById('hub-panel-remotes') as HTMLElement;
    await hub.owner?.render(panel);
  }

  beforeEach(async () => {
    ({ store } = await mount());
  });

  it('re-reads origin after a remote is removed', async () => {
    // Origin is not this panel's alone. Removing it has to reach the toolbar,
    // or the Publish button and the SSH/HTTPS chip keep describing a remote
    // that is gone until the next full refresh.
    await renderRemotesPanel([
      {
        name: 'origin',
        fetchUrl: 'git@github.com:owner/repo.git',
        pushUrl: 'git@github.com:owner/repo.git',
        fetchRefspecs: [],
        pushRefspecs: [],
        prune: false,
        pruneInherited: false,
        isDefaultPush: true
      }
    ]);

    repo.refreshOrigin.mockClear();

    const remove = document.querySelector<HTMLButtonElement>(
      '#hub-panel-remotes button[title="Remove this remote"]'
    );
    expect(remove, 'the panel should render a remove action per remote').not.toBeNull();

    remove?.click();
    // The handler is fired without being awaited, so let its promise settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(endpoints.removeRemote).toHaveBeenCalledWith('origin');
    expect(repo.refreshOrigin).toHaveBeenCalled();
  });
});

describe('the auto-pull chip', () => {
  let store: Store;

  const chip = (): HTMLButtonElement =>
    document.getElementById('btn-auto-pull') as HTMLButtonElement;

  beforeEach(async () => {
    ({ store } = await mount());
  });

  it('stays out of the toolbar until a repository is open', () => {
    expect(chip().classList.contains('hidden')).toBe(true);

    store.update({ activeRepo: 'D:/work/app' });

    expect(chip().classList.contains('hidden')).toBe(false);
  });

  it('shows whether the setting is on', () => {
    store.update({ activeRepo: 'D:/work/app', autoPull: false });
    expect(chip().classList.contains('chip-on')).toBe(false);
    expect(chip().getAttribute('aria-pressed')).toBe('false');

    store.update({ autoPull: true });
    expect(chip().classList.contains('chip-on')).toBe(true);
    expect(chip().getAttribute('aria-pressed')).toBe('true');
  });

  it('says what is holding it back when it is on but would not act', () => {
    // "On but nothing happened" is the confusing state, so the tooltip names
    // the condition rather than leaving the user to guess.
    store.update({
      activeRepo: 'D:/work/app',
      autoPull: true,
      status: status({ tracking: 'origin/main', behind: 2, ahead: 1 })
    });

    expect(chip().title).toMatch(/would not act right now/);
    expect(chip().title).toMatch(/commits of its own/);
  });

  it('says it will act when the branch is purely behind', () => {
    store.update({
      activeRepo: 'D:/work/app',
      autoPull: true,
      status: status({ tracking: 'origin/main', behind: 3 })
    });

    expect(chip().title).toMatch(/will fast-forward/);
  });

  it('saves the setting when clicked', async () => {
    store.update({ activeRepo: 'D:/work/app', autoPull: false });

    const sync = await import('../src/renderer/features/sync');
    await sync.toggleAutoPull();

    expect(endpoints.saveAppSettings).toHaveBeenCalledWith({ autoPull: true });
    expect(chip().classList.contains('chip-on')).toBe(true);
  });
});
