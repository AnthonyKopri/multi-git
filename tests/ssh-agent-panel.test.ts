// @vitest-environment happy-dom
//
// The agent panel in the accounts dropdown.
//
// What matters here is that the panel only offers an action that would help.
// A repair button on a healthy agent, or on a platform where the app cannot
// touch the service, is worse than no button: it invites a UAC prompt for
// nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { SshAgentState } from '../src/shared/ssh-agent-types';

function agentState(overrides: Partial<SshAgentState> = {}): SshAgentState {
  return {
    platform: 'win32',
    availability: 'ready',
    socketPresent: true,
    keys: [],
    selectedKeyLoaded: false,
    repairRequiresElevation: false,
    ...overrides
  };
}

const endpoints = vi.hoisted(() => ({
  getSshAgentStatus: vi.fn(),
  loadSshAgentKey: vi.fn(),
  unloadSshAgentKey: vi.fn()
}));

const state = vi.hoisted(() => ({ activeRepo: '/repo', activeProfileId: 'p1' }));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/state/store', () => ({ getState: () => state }));

async function mount() {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const panel = await import('../src/renderer/features/accounts/agent');

  panel.initAgentPanel(resolveElements());
  return panel;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const hidden = (id: string): boolean => $(id).classList.contains('hidden');

beforeEach(async () => {
  endpoints.getSshAgentStatus.mockReset();
  endpoints.loadSshAgentKey.mockReset();
  endpoints.unloadSshAgentKey.mockReset();

  // The toast spy is module-level, so calls leak between tests and
  // `mock.calls[0]` would belong to whichever test ran first.
  const { showToast } = await import('../src/renderer/ui/toast');
  vi.mocked(showToast).mockClear();

  state.activeProfileId = 'p1';
  delete (window as { desktopApi?: unknown }).desktopApi;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('status rendering', () => {
  it('reports a loaded key', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ selectedProfileId: 'p1', selectedKeyLoaded: true })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: key loaded');
    expect($('agent-status-chip').className).toContain('agent-ok');
    expect(hidden('btn-repair-agent')).toBe(true);
    // Unloading is offered only for a key that is actually there.
    expect(hidden('btn-unload-key')).toBe(false);
  });

  it('distinguishes a working agent that lacks the selected key', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ selectedProfileId: 'p1', selectedKeyLoaded: false })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: key not loaded');
    expect($('agent-status-chip').className).toContain('agent-warn');
    // Nothing to repair: the agent is fine, the key just is not in it.
    expect(hidden('btn-repair-agent')).toBe(true);
  });

  it('counts keys when no profile is selected', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ keys: [{ fingerprint: 'SHA256:a', source: 'pre-existing' }] })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: ready · 1 key(s)');
  });

  it('offers repair for a disabled service and shows why', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({
        availability: 'disabled',
        socketPresent: false,
        repairRequiresElevation: true,
        diagnostic: 'The service is disabled.'
      })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: disabled');
    expect($('agent-status-chip').className).toContain('agent-off');
    expect(hidden('btn-repair-agent')).toBe(false);
    expect(hidden('agent-diagnostic')).toBe(false);
    expect($('agent-diagnostic').textContent).toContain('disabled');
  });

  it('offers repair for a stopped service', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ availability: 'stopped', socketPresent: false })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: not running');
    expect(hidden('btn-repair-agent')).toBe(false);
  });

  it('does not offer repair when there is no service to repair', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ availability: 'missing', socketPresent: false })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: not installed');
    expect(hidden('btn-repair-agent')).toBe(true);
  });

  it('does not offer repair off Windows, where it cannot act', async () => {
    // The service model is Windows-specific. A button that cannot work is
    // worse than none.
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({
        platform: 'linux',
        availability: 'unreachable',
        socketPresent: false,
        diagnostic: 'Start one with eval $(ssh-agent).'
      })
    });

    const panel = await mount();
    await panel.refreshAgent();

    expect(hidden('btn-repair-agent')).toBe(true);
    expect($('agent-diagnostic').textContent).toContain('ssh-agent');
  });

  it('falls back to a neutral chip when the status cannot be read', async () => {
    endpoints.getSshAgentStatus.mockRejectedValue(new Error('offline'));

    const panel = await mount();
    await panel.refreshAgent();

    expect($('agent-status-chip').textContent).toBe('Agent: —');
    expect(hidden('btn-repair-agent')).toBe(true);
  });
});

describe('loading the selected key', () => {
  it('sends the active repository and profile', async () => {
    endpoints.loadSshAgentKey.mockResolvedValue({
      success: true,
      agent: agentState({ selectedProfileId: 'p1', selectedKeyLoaded: true }),
      routingChanged: true
    });

    const panel = await mount();
    await panel.loadSelectedKey('p1');

    expect(endpoints.loadSshAgentKey).toHaveBeenCalledWith('/repo', 'p1');
    expect($('agent-status-chip').textContent).toBe('Agent: key loaded');
  });

  it('renders a failure without throwing', async () => {
    // A degraded agent must never block the rest of the app.
    endpoints.loadSshAgentKey.mockResolvedValue({
      success: false,
      agent: agentState({ availability: 'disabled', socketPresent: false }),
      routingChanged: false,
      error: 'The service is disabled.',
      code: 'REPAIR_REQUIRED'
    });

    const panel = await mount();
    await expect(panel.loadSelectedKey('p1')).resolves.toBeUndefined();

    expect(hidden('btn-repair-agent')).toBe(false);
  });

  it('survives the request failing outright', async () => {
    endpoints.loadSshAgentKey.mockRejectedValue(new Error('network down'));

    const panel = await mount();

    await expect(panel.loadSelectedKey('p1')).resolves.toBeUndefined();
  });
});

describe('repair', () => {
  it('explains itself in browser mode, where elevation is unavailable', async () => {
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ availability: 'disabled', socketPresent: false })
    });

    const panel = await mount();
    await panel.refreshAgent();

    const { showToast } = await import('../src/renderer/ui/toast');
    $('btn-repair-agent').click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(vi.mocked(showToast).mock.calls[0]?.[0]).toContain('Set-Service ssh-agent');
  });

  it('calls the desktop bridge with no arguments', async () => {
    // The elevated command is a constant in the main process. Forwarding
    // anything from here would be the beginning of a way to influence it.
    const repairSshAgent = vi.fn().mockResolvedValue({
      success: true,
      cancelled: false,
      message: 'Service started.'
    });
    (window as { desktopApi?: unknown }).desktopApi = { repairSshAgent };

    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ availability: 'disabled', socketPresent: false })
    });
    endpoints.loadSshAgentKey.mockResolvedValue({
      success: true,
      agent: agentState({ selectedKeyLoaded: true }),
      routingChanged: false
    });

    const panel = await mount();
    await panel.refreshAgent();

    $('btn-repair-agent').click();
    await vi.waitFor(() => expect(repairSshAgent).toHaveBeenCalled());

    expect(repairSshAgent).toHaveBeenCalledWith();
  });

  it('treats a declined prompt as a choice, not a failure', async () => {
    const repairSshAgent = vi.fn().mockResolvedValue({
      success: false,
      cancelled: true,
      message: 'Administrator approval was declined.'
    });
    (window as { desktopApi?: unknown }).desktopApi = { repairSshAgent };

    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ availability: 'disabled', socketPresent: false })
    });

    const panel = await mount();
    await panel.refreshAgent();

    const { showToast } = await import('../src/renderer/ui/toast');

    $('btn-repair-agent').click();
    await vi.waitFor(() => expect(repairSshAgent).toHaveBeenCalled());

    // No error toast: declining is a legitimate answer.
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('unloading', () => {
  it('reports refusal to remove a key this session did not load', async () => {
    endpoints.unloadSshAgentKey.mockResolvedValue({
      success: false,
      agent: agentState({ selectedKeyLoaded: true }),
      error: 'That identity was not loaded by Multi-Git.',
      code: 'NOT_SESSION_OWNED'
    });
    endpoints.getSshAgentStatus.mockResolvedValue({
      success: true,
      agent: agentState({ selectedProfileId: 'p1', selectedKeyLoaded: true })
    });

    const panel = await mount();
    await panel.refreshAgent();

    const { showToast } = await import('../src/renderer/ui/toast');

    $('btn-unload-key').click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(vi.mocked(showToast).mock.calls[0]?.[0]).toContain('not loaded by Multi-Git');
  });

  it('does nothing when no profile is selected', async () => {
    state.activeProfileId = '';

    await mount();
    $('btn-unload-key').click();
    await Promise.resolve();

    expect(endpoints.unloadSshAgentKey).not.toHaveBeenCalled();
  });
});
