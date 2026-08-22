// @vitest-environment happy-dom
//
// The Settings window, against the real index.html.
//
// Every control here writes immediately, which makes one property worth
// pinning above all others: a write carries the setting that changed and
// nothing else. The route merges what it is given over what is stored, so a
// window that sent its whole form would quietly overwrite a setting changed in
// another window since it opened.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import { DEFAULT_STALE_RULES } from '../src/shared/maintenance-types';
import type { AppSettings, ClientConfig } from '../src/shared/config-types';

const endpoints = vi.hoisted(() => ({
  getConfig: vi.fn(),
  saveAppSettings: vi.fn()
}));

const accounts = vi.hoisted(() => ({
  applyConfigSnapshot: vi.fn(),
  onManageSshConfigChanged: vi.fn()
}));

const store = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/features/accounts', () => accounts);
vi.mock('../src/renderer/state/store', () => store);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    manageSshConfig: true,
    autoPull: false,
    checkForUpdates: true,
    restoreWindowsOnStartup: true,
    storeAgentPrompts: false,
    recoveryRetentionDays: 14,
    staleRules: { ...DEFAULT_STALE_RULES },
    ...overrides
  };
}

const config = (overrides: Partial<AppSettings> = {}) =>
  ({ settings: settings(overrides) }) as unknown as ClientConfig;

async function mount(overrides: Partial<AppSettings> = {}) {
  endpoints.getConfig.mockResolvedValue(config(overrides));

  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const feature = await import('../src/renderer/features/settings');

  feature.initSettings(resolveElements());
  await feature.openSettings();

  return feature;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/** The checkbox whose label starts with `label`. */
function toggle(label: string): HTMLInputElement {
  const box = [...$('settings-body').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (candidate) => candidate.getAttribute('aria-label')?.startsWith(label)
  );

  if (!box) {
    throw new Error(`No toggle labelled "${label}"`);
  }

  return box;
}

function field(label: string): HTMLInputElement {
  const input = [...$('settings-body').querySelectorAll<HTMLInputElement>('input.settings-field')].find(
    (candidate) => candidate.getAttribute('aria-label')?.startsWith(label)
  );

  if (!input) {
    throw new Error(`No field labelled "${label}"`);
  }

  return input;
}

function change(input: HTMLInputElement, value: string | boolean): void {
  if (typeof value === 'boolean') {
    input.checked = value;
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('change'));
}

const lastSave = (): Record<string, unknown> =>
  endpoints.saveAppSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  endpoints.getConfig.mockReset();
  endpoints.saveAppSettings.mockReset();
  accounts.applyConfigSnapshot.mockReset();
  accounts.onManageSshConfigChanged.mockReset();
  store.update.mockReset();

  endpoints.saveAppSettings.mockImplementation(async () => ({ success: true, config: config() }));
  accounts.onManageSshConfigChanged.mockResolvedValue(false);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('what the window shows', () => {
  it('draws every setting from the stored configuration', async () => {
    await mount({ autoPull: true, checkForUpdates: false, recoveryRetentionDays: 30 });

    expect(toggle('Pull automatically').checked).toBe(true);
    expect(toggle('Check GitHub').checked).toBe(false);
    expect(field('Keep recovery points').value).toBe('30');
  });

  it('reads the stale rules back as a sentence, the same one the tab shows', async () => {
    await mount();

    expect($('settings-body').textContent).toContain(
      'A branch is stale when no pull request was ever opened for it and nothing has landed on it for 60 days.'
    );
  });

  it('shows the default for a setting the file has never carried', async () => {
    await mount({ restoreWindowsOnStartup: undefined, checkForUpdates: undefined });

    // Both default to on. An absent value must not read as "off", or the
    // window would offer to turn on something already running.
    expect(toggle('Reopen the windows').checked).toBe(true);
    expect(toggle('Check GitHub').checked).toBe(true);
  });
});

describe('writing a setting', () => {
  it('sends only the setting that changed', async () => {
    await mount();

    change(toggle('Check GitHub'), false);

    expect(lastSave()).toEqual({ checkForUpdates: false });
  });

  it('keeps the toolbar chip in step when auto-pull changes', async () => {
    endpoints.saveAppSettings.mockResolvedValue({ success: true, config: config({ autoPull: true }) });
    await mount();

    change(toggle('Pull automatically'), true);
    await vi.waitFor(() => expect(store.update).toHaveBeenCalled());

    // The chip renders from the store, not from this window's copy.
    expect(store.update).toHaveBeenCalledWith({ autoPull: true });
  });

  it('writes the whole rule set when one rule is ticked', async () => {
    await mount();

    change(toggle('No remote has a copy of it'), true);

    expect(lastSave()).toEqual({
      staleRules: { ...DEFAULT_STALE_RULES, requireUnpushed: true }
    });
  });

  it('routes the ~/.ssh/config toggle through the handler that asks first', async () => {
    await mount();

    change(toggle('Keep ~/.ssh/config in sync'), false);

    // Turning it off asks whether to remove the block it already wrote, and
    // that question belongs to the one handler that knows how to ask it.
    expect(accounts.onManageSshConfigChanged).toHaveBeenCalledWith(false);
    expect(endpoints.saveAppSettings).not.toHaveBeenCalled();
  });

  it('ignores a retention that is not a number of days', async () => {
    await mount();

    change(field('Keep recovery points'), '');

    // An empty box means "leave it alone". Reading it as 0 would mean "keep
    // recovery points forever", which is a decision the user did not make.
    expect(endpoints.saveAppSettings).not.toHaveBeenCalled();
    expect(field('Keep recovery points').value).toBe('14');
  });

  it('accepts a retention of zero, which means keep them indefinitely', async () => {
    await mount();

    change(field('Keep recovery points'), '0');

    expect(lastSave()).toEqual({ recoveryRetentionDays: 0 });
  });

  it('redraws from what the server stored, not from what was typed', async () => {
    endpoints.saveAppSettings.mockResolvedValue({
      success: true,
      // The server clamped it.
      config: config({ staleRules: { ...DEFAULT_STALE_RULES, inactiveDays: 1 } })
    });

    await mount();
    const days = $('settings-body').querySelector('.stale-days') as HTMLInputElement;
    change(days, '0');

    await vi.waitFor(() => {
      const redrawn = $('settings-body').querySelector('.stale-days') as HTMLInputElement;
      expect(redrawn.value).toBe('1');
    });
  });
});
