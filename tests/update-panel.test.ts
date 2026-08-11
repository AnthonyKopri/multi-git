// @vitest-environment happy-dom
//
// The update notice in the navbar and the modal behind it.
//
// The two things worth pinning here are the degradation and the intents. In a
// browser tab, on macOS, and in a dev run there is no bridge or the bridge says
// unsupported, and this feature has to register nothing and show nothing. When
// it is supported, each button must send the intent the current phase implies —
// the renderer has no other way to act, because it is never told a URL.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { UpdateState } from '../src/shared/update-types';

vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));

interface Bridge {
  getUpdateState: ReturnType<typeof vi.fn>;
  checkForUpdate: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
  skipUpdateVersion: ReturnType<typeof vi.fn>;
  onUpdateState: ReturnType<typeof vi.fn>;
  onUpdatePopup: ReturnType<typeof vi.fn>;
}

function state(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    phase: 'available',
    supported: true,
    installKind: 'installer',
    currentVersion: '3.1.1',
    latest: { version: '3.2.0', tag: 'Release_v3.2.0', name: 'Multi-Git 3.2.0', notes: 'Fixes.' },
    ...overrides
  };
}

function makeBridge(): Bridge {
  return {
    getUpdateState: vi.fn().mockResolvedValue(state({ phase: 'idle', latest: undefined })),
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    skipUpdateVersion: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn(),
    onUpdatePopup: vi.fn()
  };
}

/** Mounts the real index.html and inits the feature against a bridge. */
async function mount(bridge: Bridge | null) {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  if (bridge) {
    (window as { desktopApi?: unknown }).desktopApi = bridge;
  } else {
    delete (window as { desktopApi?: unknown }).desktopApi;
  }

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const updates = await import('../src/renderer/features/updates');

  updates.initUpdates(resolveElements());
  return updates;
}

/** Delivers a state through whatever listener the feature registered. */
function push(bridge: Bridge, next: UpdateState): void {
  const listener = bridge.onUpdateState.mock.calls[0]?.[0] as (s: UpdateState) => void;
  listener(next);
}

function popup(bridge: Bridge): void {
  (bridge.onUpdatePopup.mock.calls[0]?.[0] as () => void)();
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const hidden = (id: string): boolean => $(id).classList.contains('hidden');

let bridge: Bridge;

beforeEach(() => {
  bridge = makeBridge();
});

describe('when the app cannot update itself', () => {
  it('shows nothing and registers nothing in browser mode', async () => {
    await mount(null);

    expect(hidden('btn-update')).toBe(true);
    expect(hidden('update-modal')).toBe(true);
  });

  it('leaves the icon hidden on an unsupported build', async () => {
    await mount(bridge);
    push(bridge, state({ phase: 'idle', supported: false, latest: undefined }));

    expect(hidden('btn-update')).toBe(true);
  });
});

describe('announcing an update', () => {
  it('shows the icon once a release has been resolved', async () => {
    await mount(bridge);
    expect(hidden('btn-update')).toBe(true);

    push(bridge, state());
    expect(hidden('btn-update')).toBe(false);
    expect($('btn-update').title).toMatch(/3\.2\.0/);
  });

  it('opens the popup when told to, naming both versions', async () => {
    await mount(bridge);
    push(bridge, state());
    popup(bridge);

    expect(hidden('update-modal')).toBe(false);
    expect($('update-message').textContent).toMatch(/3\.2\.0/);
    expect($('update-message').textContent).toMatch(/3\.1\.1/);
  });

  it('says what will actually happen, which differs per build', async () => {
    await mount(bridge);

    push(bridge, state());
    expect($('update-message').textContent).toMatch(/restarts/i);

    push(bridge, state({ installKind: 'portable' }));
    expect($('update-message').textContent).toMatch(/next to this one/i);
  });

  it('holds the popup back when another modal already owns the screen', async () => {
    await mount(bridge);
    $('ssh-health-modal').classList.remove('hidden');

    push(bridge, state());
    popup(bridge);

    // The icon still appears, so the notice is not lost — only deferred.
    expect(hidden('update-modal')).toBe(true);
    expect(hidden('btn-update')).toBe(false);
  });

  it('reopens the popup from the icon', async () => {
    await mount(bridge);
    push(bridge, state());
    $('btn-update').click();

    expect(hidden('update-modal')).toBe(false);
  });

  it('shows release notes as text, never as markup', async () => {
    await mount(bridge);
    push(
      bridge,
      state({
        latest: {
          version: '3.2.0',
          tag: 'Release_v3.2.0',
          name: 'x',
          notes: '<img src=x onerror=alert(1)>'
        }
      })
    );

    expect($('update-notes').textContent).toBe('<img src=x onerror=alert(1)>');
    expect($('update-notes').querySelector('img')).toBeNull();
  });
});

describe('acting on an update', () => {
  it('asks to download, and downloads nothing before being asked', async () => {
    await mount(bridge);
    push(bridge, state());

    expect(bridge.downloadUpdate).not.toHaveBeenCalled();
    $('btn-update-install').click();
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows progress and refuses a second click while downloading', async () => {
    await mount(bridge);
    push(bridge, state({ phase: 'downloading', percent: 42 }));

    expect(hidden('update-progress')).toBe(false);
    expect($('update-progress-bar').style.width).toBe('42%');
    expect($('update-badge').textContent).toBe('42%');
    expect(($('btn-update-install') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the install once the download is verified', async () => {
    await mount(bridge);
    push(bridge, state({ phase: 'ready', percent: 100 }));

    expect($('btn-update-install').textContent).toMatch(/restart & install/i);
    $('btn-update-install').click();
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('offers to open the file instead of restarting, on a portable build', async () => {
    await mount(bridge);
    push(bridge, state({ phase: 'ready', installKind: 'portable' }));

    expect($('btn-update-install').textContent).toMatch(/open new version/i);
  });

  it('reports a failure and offers another attempt', async () => {
    await mount(bridge);
    push(bridge, state({ phase: 'error', message: 'The downloaded file did not match.' }));

    expect($('update-message').textContent).toBe('The downloaded file did not match.');
    expect($('btn-update-install').textContent).toMatch(/try again/i);

    $('btn-update-install').click();
    expect(bridge.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });

  it('closes on Later without skipping anything', async () => {
    await mount(bridge);
    push(bridge, state());
    popup(bridge);

    $('btn-update-later').click();
    expect(hidden('update-modal')).toBe(true);
    expect(hidden('btn-update')).toBe(false);
    expect(bridge.skipUpdateVersion).not.toHaveBeenCalled();
  });

  it('skips the version, and only offers that before work has started', async () => {
    await mount(bridge);
    push(bridge, state());
    expect(hidden('btn-update-skip')).toBe(false);

    $('btn-update-skip').click();
    expect(bridge.skipUpdateVersion).toHaveBeenCalledTimes(1);
    expect(hidden('update-modal')).toBe(true);

    push(bridge, state({ phase: 'ready' }));
    expect(hidden('btn-update-skip')).toBe(true);
  });
});

describe('a window opened after the check', () => {
  it('seeds itself rather than waiting for the next broadcast', async () => {
    bridge.getUpdateState.mockResolvedValue(state());
    await mount(bridge);
    await vi.waitFor(() => expect(hidden('btn-update')).toBe(false));

    expect(bridge.getUpdateState).toHaveBeenCalledTimes(1);
  });
});
