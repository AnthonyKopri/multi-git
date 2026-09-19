// @vitest-environment happy-dom
//
// The coding agents window and the launch dialog, against the real index.html.
//
// Mounting the actual markup is what makes a renamed element id fail here
// rather than produce a dialog that silently never renders. Three promises are
// pinned:
//
//   * The prompt never appears in what is shown, logged or stored. The command
//     preview is the one new place it could have leaked into, so the preview
//     is asserted to stop short of it.
//
//   * A model preset changes the command line, and the page shows the change
//     before anything starts rather than after.
//
//   * The page sends an agent id and a model id, never an executable, a flag
//     or a base URL. What those ids mean is decided in the main process.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import { AGENT_CATALOGUE } from '../src/shared/agent-catalogue';
import type { ExternalAgentDefinition } from '../src/shared/config-types';

function agent(overrides: Partial<ExternalAgentDefinition> = {}): ExternalAgentDefinition {
  return {
    id: 'a1',
    label: 'Claude Code',
    executable: 'claude',
    args: [],
    terminal: 'system-terminal',
    enabled: true,
    promptMode: 'argument',
    catalogueId: 'claude',
    ...overrides
  };
}

const gemini = agent({
  id: 'a2',
  label: 'Gemini CLI',
  executable: 'gemini',
  promptMode: 'flag',
  promptArgs: ['-i'],
  catalogueId: 'gemini'
});

const endpoints = vi.hoisted(() => ({
  getAgents: vi.fn(),
  detectAgents: vi.fn(),
  addDetectedAgents: vi.fn(),
  saveAgent: vi.fn(),
  deleteAgent: vi.fn(),
  clearAgentLaunches: vi.fn()
}));

const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));
const launchAgent = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  activeRepo: 'D:\\work\\app',
  activeProfileId: '',
  status: { branch: 'feature/login' } as { branch: string } | null
}));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/dialogs', () => dialogs);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/state/store', () => ({
  getState: () => state,
  activeProfile: () => (state.activeProfileId === '' ? null : { label: 'Work' })
}));
vi.mock('../src/renderer/ui/busy', () => ({
  withButtonBusy: async (_button: unknown, run: () => Promise<void>) => run()
}));
vi.mock('../src/renderer/features/accounts/unlock', () => ({ ensureKeyUsable: vi.fn() }));
vi.mock('../src/renderer/ui/no-repo', () => ({ warnNoRepo: vi.fn() }));

async function mount() {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const feature = await import('../src/renderer/features/agents');

  feature.initAgents(resolveElements());
  return feature;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/** The launch dialog's card for an agent, by the label it shows. */
function card(label: string): HTMLElement {
  const found = [...$('agent-launch-picker').querySelectorAll<HTMLElement>('[data-agent-id]')].find(
    (candidate) => candidate.textContent?.includes(label)
  );

  if (!found) {
    throw new Error(`No launch card for ${label}`);
  }

  return found;
}

beforeEach(() => {
  for (const mock of Object.values(endpoints)) {
    mock.mockReset();
  }
  dialogs.confirmDialog.mockReset();
  launchAgent.mockReset();
  launchAgent.mockResolvedValue({ launched: true, commandPreview: 'claude' });

  state.activeProfileId = '';
  state.status = { branch: 'feature/login' };

  endpoints.getAgents.mockResolvedValue({
    success: true,
    agents: [agent(), gemini],
    launches: [],
    catalogue: AGENT_CATALOGUE
  });
  endpoints.detectAgents.mockResolvedValue({ success: true, detected: [] });

  (window as unknown as { desktopApi?: unknown }).desktopApi = { launchAgent };
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { desktopApi?: unknown }).desktopApi;
});

describe('the launch dialog', () => {
  it('shows the folder, its branch and the account it will push as', async () => {
    state.activeProfileId = 'p1';
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    expect($('agent-launch-target').textContent).toBe('D:\\work\\app');
    expect($('agent-launch-branch').textContent).toBe('On feature/login');
    expect($('agent-launch-account').textContent).toBe('Work');
  });

  it('offers one card per enabled agent, carrying the vendor', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    expect($('agent-launch-picker').querySelectorAll('[data-agent-id]')).toHaveLength(2);
    expect(card('Gemini CLI').textContent).toContain('Google');
  });

  it('leaves a disabled agent out', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent(), agent({ id: 'a3', label: 'Off one', enabled: false })],
      launches: [],
      catalogue: AGENT_CATALOGUE
    });

    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    expect($('agent-launch-picker').querySelectorAll('[data-agent-id]')).toHaveLength(1);
  });

  it('starts on the agent that last actually launched', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent(), gemini],
      launches: [
        {
          at: new Date().toISOString(),
          agentId: 'a2',
          agentLabel: 'Gemini CLI',
          worktreePath: 'D:\\work\\app',
          ok: true,
          commandPreview: 'gemini'
        }
      ],
      catalogue: AGENT_CATALOGUE
    });

    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    expect(card('Gemini CLI').getAttribute('aria-checked')).toBe('true');
    expect(card('Claude Code').getAttribute('aria-checked')).toBe('false');
  });

  it('shows the command that will run, and never the prompt in it', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    const prompt = $('agent-launch-prompt') as HTMLTextAreaElement;
    prompt.value = 'a secret internal design document';
    feature.onLaunchPromptChanged();

    // One line is always on screen; the rest is behind the disclosure. Neither
    // may carry the prompt.
    expect($('agent-launch-command').textContent).toBe('claude <your prompt>');
    expect($('agent-launch-preview').textContent).not.toContain('secret');
    expect($('agent-launch-command').textContent).not.toContain('secret');
  });

  it('puts a prompt flag in the preview where the launcher will put it', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    feature.handleLaunchPickerClick(card('Gemini CLI'));
    ($('agent-launch-prompt') as HTMLTextAreaElement).value = 'rename it';
    feature.onLaunchPromptChanged();

    expect($('agent-launch-command').textContent).toBe('gemini -i <your prompt>');
  });

  it('hides the prompt box for a tool that takes no prompt', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent({ promptMode: 'none', catalogueId: 'aider', label: 'Aider' })],
      launches: [],
      catalogue: AGENT_CATALOGUE
    });

    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    expect($('agent-launch-prompt-row').classList.contains('hidden')).toBe(true);
  });

  it('offers the models its catalogue entry has, and says which key they need', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    const models = $('agent-launch-model') as HTMLSelectElement;
    expect($('agent-launch-model-row').classList.contains('hidden')).toBe(false);
    expect([...models.options].map((option) => option.value)).toContain('deepseek');

    models.value = 'kimi-k2';
    feature.onLaunchModelChanged();

    // Named so the user knows what to export, never collected: a key typed
    // into Multi-Git would land in a plain JSON file in the home directory.
    expect($('agent-launch-model-note').textContent).toContain('ANTHROPIC_AUTH_TOKEN');
    expect($('agent-launch-model-note').textContent).toContain('never stores a key');
  });

  it('shows the model in the command, and the base URL as environment', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    ($('agent-launch-model') as HTMLSelectElement).value = 'deepseek';
    feature.onLaunchModelChanged();

    // The base URL is environment, not an argument, so it is not on the line.
    expect($('agent-launch-command').textContent).toBe('claude');
    expect($('agent-launch-preview').textContent).toContain('with ANTHROPIC_BASE_URL');
  });

  it('hides the model row for an agent with nothing to choose between', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    feature.handleLaunchPickerClick(card('Gemini CLI'));
    expect($('agent-launch-model-row').classList.contains('hidden')).toBe(false);

    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent({ catalogueId: 'kimi', label: 'Kimi CLI', executable: 'kimi' })],
      launches: [],
      catalogue: AGENT_CATALOGUE
    });
    await feature.launchAgentFor('D:\\work\\app');

    expect($('agent-launch-model-row').classList.contains('hidden')).toBe(true);
  });

  it('sends an agent id and a model id, and never a flag or a URL', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    ($('agent-launch-model') as HTMLSelectElement).value = 'opus';
    feature.onLaunchModelChanged();
    ($('agent-launch-prompt') as HTMLTextAreaElement).value = '  tidy the imports  ';

    await feature.submitLaunch();

    expect(launchAgent).toHaveBeenCalledWith({
      repoPath: 'D:\\work\\app',
      worktreePath: 'D:\\work\\app',
      agentId: 'a1',
      initialPrompt: 'tidy the imports',
      modelId: 'opus'
    });
  });

  it('sends no prompt at all when the box is empty', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');
    await feature.submitLaunch();

    expect(launchAgent.mock.calls[0]?.[0]).not.toHaveProperty('initialPrompt');
  });

  it('closes on a launch that started, and stays open on one that did not', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');
    await feature.submitLaunch();
    expect($('agent-launch-modal').classList.contains('hidden')).toBe(true);

    launchAgent.mockResolvedValue({ launched: false, commandPreview: '', error: 'nope' });
    await feature.launchAgentFor('D:\\work\\app');
    await feature.submitLaunch();
    expect($('agent-launch-modal').classList.contains('hidden')).toBe(false);
  });
});

describe('reaching another agent from the launch dialog', () => {
  /** Detection that finds the given catalogue ids installed. */
  function detected(installedIds: string[], configuredIds: string[] = []) {
    return {
      success: true,
      detected: AGENT_CATALOGUE.map((entry) => ({
        id: entry.id,
        label: entry.label,
        vendor: entry.vendor,
        summary: entry.summary,
        homepage: entry.homepage,
        executable: entry.executable,
        resolvedPath: installedIds.includes(entry.id) ? `/usr/bin/${entry.executable}` : '',
        installed: installedIds.includes(entry.id),
        configured: configuredIds.includes(entry.id),
        hasModels: (entry.models ?? []).length > 0
      }))
    };
  }

  const addableCards = (): HTMLElement[] => [
    ...$('agent-launch-picker').querySelectorAll<HTMLElement>('[data-catalogue-id]')
  ];

  it('offers installed tools that are not added yet, after the configured ones', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent()],
      launches: [],
      catalogue: AGENT_CATALOGUE
    });
    endpoints.detectAgents.mockResolvedValue(detected(['claude', 'gemini'], ['claude']));

    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');
    await vi.waitUntil(() => addableCards().length > 0);

    // Claude Code is configured, so it is a normal card and not offered twice.
    expect(addableCards().map((card) => card.dataset['catalogueId'])).toEqual(['gemini']);
    expect(card('Claude Code').getAttribute('aria-checked')).toBe('true');
  });

  it('adds a picked tool and selects it, without leaving the dialog', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent()],
      launches: [],
      catalogue: AGENT_CATALOGUE
    });
    endpoints.detectAgents.mockResolvedValue(detected(['claude', 'gemini'], ['claude']));
    endpoints.saveAgent.mockImplementation(async (input: Partial<ExternalAgentDefinition>) => {
      endpoints.getAgents.mockResolvedValue({
        success: true,
        agents: [agent(), gemini],
        launches: [],
        catalogue: AGENT_CATALOGUE
      });
      return { success: true, agent: { ...gemini, ...input, id: 'a2' } };
    });

    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');
    await vi.waitUntil(() => addableCards().length > 0);

    feature.handleLaunchPickerClick(addableCards()[0] as HTMLElement);
    await vi.waitUntil(
      () =>
        $('agent-launch-picker')
          .querySelector('[data-agent-id="a2"]')
          ?.getAttribute('aria-checked') === 'true'
    );

    expect(endpoints.saveAgent.mock.calls[0]?.[0]).toMatchObject({
      catalogueId: 'gemini',
      promptMode: 'flag',
      promptArgs: ['-i']
    });
    expect($('agent-launch-modal').classList.contains('hidden')).toBe(false);
    expect($('agent-launch-command').textContent).toContain('gemini');
  });

  it('opens with nothing added when the machine has a tool to offer', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [],
      launches: [],
      catalogue: AGENT_CATALOGUE
    });
    endpoints.detectAgents.mockResolvedValue(detected(['codex']));

    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    expect($('agent-launch-modal').classList.contains('hidden')).toBe(false);
    expect(addableCards().map((card) => card.dataset['catalogueId'])).toEqual(['codex']);
    // Nothing is selected yet, so there is nothing to launch.
    expect(($('btn-launch-agent') as HTMLButtonElement).disabled).toBe(true);
  });

  it('always has a way to the rest of the known tools', async () => {
    const feature = await mount();
    await feature.launchAgentFor('D:\\work\\app');

    const more = $('agent-launch-picker').querySelector<HTMLElement>('[data-launch-action="manage"]');
    expect(more).not.toBeNull();

    feature.handleLaunchPickerClick(more as HTMLElement);
    expect($('agent-launch-modal').classList.contains('hidden')).toBe(true);
    expect($('agents-modal').classList.contains('hidden')).toBe(false);
  });
});

describe('the agents window', () => {
  it('lists every definition with how it opens and whether it takes a prompt', async () => {
    const feature = await mount();
    await feature.refreshAgents();

    const rows = $('agent-list').querySelectorAll<HTMLElement>('[data-agent-id]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('opens in your terminal');
    expect(rows[1]?.textContent).toContain('takes a prompt after -i');
  });

  it('keeps a row to four actions, so the strip stays readable', async () => {
    const feature = await mount();
    await feature.refreshAgents();

    const rows = [...$('agent-list').querySelectorAll<HTMLElement>('[data-agent-id]')];
    expect([...(rows[0]?.querySelectorAll('[data-action]') ?? [])].map(
      (button) => (button as HTMLElement).dataset['action']
    )).toEqual(['toggle', 'edit', 'duplicate', 'delete']);
  });

  it('shows every known tool, marked with what this machine has', async () => {
    endpoints.detectAgents.mockResolvedValue({
      success: true,
      detected: AGENT_CATALOGUE.map((entry) => ({
        id: entry.id,
        label: entry.label,
        vendor: entry.vendor,
        summary: entry.summary,
        homepage: entry.homepage,
        executable: entry.executable,
        resolvedPath: entry.id === 'claude' ? '/usr/bin/claude' : '',
        installed: entry.id === 'claude',
        configured: entry.id === 'claude',
        hasModels: (entry.models ?? []).length > 0
      }))
    });

    const feature = await mount();
    feature.openAgentManager();
    await vi.waitUntil(
      () => $('agent-catalogue-list').querySelectorAll('[data-catalogue-id]').length > 0
    );

    const rows = [...$('agent-catalogue-list').querySelectorAll<HTMLElement>('[data-catalogue-id]')];
    expect(rows).toHaveLength(AGENT_CATALOGUE.length);

    const claude = rows.find((row) => row.dataset['catalogueId'] === 'claude');
    expect(claude?.textContent).toContain('installed');
    expect(claude?.textContent).toContain('added');

    // An uninstalled tool is still shown: "not installed, here is where it
    // lives" answers a question that leaving the row out only raises.
    const qwen = rows.find((row) => row.dataset['catalogueId'] === 'qwen');
    expect(qwen?.textContent).toContain('not installed');
  });

  it('puts what this machine has at the top of the known tools', async () => {
    endpoints.detectAgents.mockResolvedValue({
      success: true,
      detected: AGENT_CATALOGUE.map((entry) => ({
        id: entry.id,
        label: entry.label,
        vendor: entry.vendor,
        summary: entry.summary,
        homepage: entry.homepage,
        executable: entry.executable,
        resolvedPath: entry.id === 'aider' ? '/usr/bin/aider' : '',
        installed: entry.id === 'aider',
        configured: false,
        hasModels: (entry.models ?? []).length > 0
      }))
    });

    const feature = await mount();
    feature.openAgentManager();
    await vi.waitUntil(() =>
      $('agent-catalogue-list').querySelector('[data-catalogue-id]')?.textContent?.includes(
        'installed'
      )
    );

    // Ordering answers "show me only what I have" without a control to turn
    // on, which is one fewer thing in a window that already has enough.
    const first = $('agent-catalogue-list').querySelector<HTMLElement>('[data-catalogue-id]');
    expect(first?.dataset['catalogueId']).toBe('aider');
  });

  it('filters the known tools by name and by vendor', async () => {
    const feature = await mount();
    await feature.refreshAgents();

    const filter = $('agent-catalogue-filter') as HTMLInputElement;
    filter.value = 'moonshot';
    feature.filterCatalogue();

    const ids = [...$('agent-catalogue-list').querySelectorAll<HTMLElement>('[data-catalogue-id]')]
      .map((row) => row.dataset['catalogueId']);
    expect(ids).toEqual(['kimi']);
  });

  it('adds a catalogue entry with the prompt mode that entry needs', async () => {
    endpoints.saveAgent.mockResolvedValue({ success: true, agent: gemini });

    const feature = await mount();
    await feature.refreshAgents();

    const row = [
      ...$('agent-catalogue-list').querySelectorAll<HTMLElement>('[data-catalogue-id]')
    ].find((candidate) => candidate.dataset['catalogueId'] === 'gemini') as HTMLElement;
    const add = row.querySelector<HTMLElement>('[data-action="add"]') as HTMLElement;

    feature.handleCatalogueAction(row, { target: add } as unknown as MouseEvent);
    await vi.waitUntil(() => endpoints.saveAgent.mock.calls.length > 0);

    expect(endpoints.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: 'gemini',
        promptMode: 'flag',
        promptArgs: ['-i'],
        catalogueId: 'gemini'
      })
    );
  });

  it('refuses to save a flag prompt mode with no flag', async () => {
    const feature = await mount();
    await feature.refreshAgents();

    ($('agent-executable-input') as HTMLInputElement).value = 'gemini';
    ($('agent-prompt-mode') as HTMLSelectElement).value = 'flag';
    ($('agent-prompt-args-input') as HTMLInputElement).value = '';

    await feature.submitAgentForm();

    expect(endpoints.saveAgent).not.toHaveBeenCalled();
  });

  it('shows the flag field only for the mode that uses one', async () => {
    const feature = await mount();
    await feature.refreshAgents();

    ($('agent-prompt-mode') as HTMLSelectElement).value = 'argument';
    feature.onPromptModeChanged();
    expect($('agent-prompt-args-row').classList.contains('hidden')).toBe(true);

    ($('agent-prompt-mode') as HTMLSelectElement).value = 'flag';
    feature.onPromptModeChanged();
    expect($('agent-prompt-args-row').classList.contains('hidden')).toBe(false);
  });

  it('asks before clearing the launch history, and does nothing when told no', async () => {
    endpoints.getAgents.mockResolvedValue({
      success: true,
      agents: [agent()],
      launches: [
        {
          at: new Date().toISOString(),
          agentId: 'a1',
          agentLabel: 'Claude Code',
          worktreePath: 'D:\\work\\app',
          ok: true,
          commandPreview: 'claude',
          modelLabel: 'Claude Opus'
        }
      ],
      catalogue: AGENT_CATALOGUE
    });
    dialogs.confirmDialog.mockResolvedValue({ confirmed: false });

    const feature = await mount();
    await feature.refreshAgents();

    // The model is worth keeping, because it changed what ran.
    expect($('agent-history-list').textContent).toContain('Claude Opus');

    await feature.clearLaunchHistory();
    expect(endpoints.clearAgentLaunches).not.toHaveBeenCalled();
  });
});
