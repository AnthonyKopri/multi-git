// The Tools tab, and the first-use confirmation every tool goes through.
//
// Detection fills in definitions from what is on the machine, which is a guess
// about two things: which program, and how it takes its arguments. The second
// is the one worth confirming — a wrong template opens the diff with the sides
// swapped rather than failing — so the first time each kind is used the exact
// expanded command is shown, with the option to pick another or edit it.
//
// Asked once per kind, not once per launch. A confirmation that appears every
// time is one nobody reads.
import * as api from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { el, icon } from '../../dom/create';
import { getState } from '../../state/store';
import { confirmDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab, openRepoHub } from '../repo-hub';
import { EXTERNAL_TOOL_KINDS } from '../../../shared/config-types';
import { TOOL_PLACEHOLDER_HELP } from '../../../shared/tool-types';
import type { ExternalToolDefinition, ExternalToolKind } from '../../../shared/config-types';

let tools: ExternalToolDefinition[] = [];
let confirmed: Record<string, boolean> = {};
let shellStatus: { supported: boolean; installed: boolean; keys: string[]; reason?: string } | null =
  null;

export function initTools(): void {
  registerHubTab('tools', { render: renderPanel });
}

// ---------- launching, with the first-use confirmation ----------

/**
 * Starts a tool, asking once per kind before the first time.
 *
 * Returns false when there is nothing configured or the user declined, so the
 * caller can fall back to whatever it did before external tools existed.
 */
export async function launchToolForKind(
  kind: ExternalToolKind,
  placeholders: Record<string, string | number | undefined>
): Promise<boolean> {
  const desktop = window.desktopApi;

  if (!desktop?.launchTool) {
    showToast('External tools are only available in the desktop app.', 'info');
    return false;
  }

  await load();
  const definition = tools.find((tool) => tool.kind === kind && tool.enabled);

  if (!definition) {
    showToast(`No ${kind} tool is configured yet.`, 'info');
    openRepoHub('tools');
    return false;
  }

  if (confirmed[kind] !== true) {
    // The expanded command, not the template: what will actually run.
    const preview = [
      definition.executable,
      ...definition.args.map((argument) =>
        argument.replace(/\{([^}]*)\}/g, (_match, name: string) =>
          String(placeholders[name] ?? `{${name}}`)
        )
      )
    ].join(' ');

    const { confirmed: agreed } = await confirmDialog(
      `Multi-Git will start this ${kind} tool:\n\n${preview}\n\n${definition.detected ? 'This definition was filled in from what is installed on your machine, so the arguments are a guess worth checking. ' : ''}You will not be asked again for ${kind} tools.`,
      {
        title: `Use ${definition.label}?`,
        confirmLabel: 'Use this tool'
      }
    );

    if (!agreed) {
      // Not confirmed, so the hub opens on Tools where another can be chosen.
      openRepoHub('tools');
      return false;
    }

    await api.confirmToolKind(kind);
    confirmed = { ...confirmed, [kind]: true };
  }

  try {
    const result = await desktop.launchTool({
      repoPath: getState().activeRepo ?? '',
      kind,
      toolId: definition.id,
      placeholders
    });

    showToast(`Started ${result.toolLabel}`, 'success');
    return result.launched;
  } catch (error) {
    showToast(errorMessage(error), 'error', 8000);
    return false;
  }
}

// ---------- the hub tab ----------

async function load(): Promise<void> {
  try {
    const state = await api.getTools();
    tools = state.tools;
    confirmed = state.confirmed;
  } catch {
    tools = [];
    confirmed = {};
  }
}

async function renderPanel(panel: HTMLElement): Promise<void> {
  await load();

  const desktop = window.desktopApi;
  if (desktop?.shellIntegrationStatus) {
    try {
      shellStatus = await desktop.shellIntegrationStatus();
    } catch {
      shellStatus = null;
    }
  }

  panel.replaceChildren(
    el('p', {
      className: 'modal-desc',
      text: 'Programs Multi-Git can hand files or a folder to. An argument template says how each one takes them; the placeholders below are filled in per launch, within each argument, so a path containing spaces stays one argument.'
    }),
    buildPlaceholderHelp(),
    buildToolbar(),
    buildList(),
    buildEditor(),
    buildShellIntegration()
  );
}

function buildPlaceholderHelp(): HTMLElement {
  return el('ul', {
    className: 'placeholder-help',
    children: TOOL_PLACEHOLDER_HELP.map((entry) =>
      el('li', {
        children: [
          el('code', { text: entry.name }),
          el('span', { text: ` — ${entry.meaning}` })
        ]
      })
    )
  });
}

function buildToolbar(): HTMLElement {
  const detect = el('button', {
    className: 'btn btn-secondary btn-sm',
    title: 'Look for known tools on your PATH and fill in a definition for each',
    children: [icon('search', 16), el('span', { text: 'Detect installed' })]
  }) as HTMLButtonElement;

  detect.addEventListener('click', () => {
    void withButtonBusy(detect, async () => {
      const { added } = await api.addDetectedTools();

      // Adding a definition is not permission to run it; the first use of each
      // kind still asks.
      showToast(
        added.length === 0
          ? 'Nothing new was found on your PATH.'
          : `Added ${added.length} definition(s). You will be asked to confirm each kind the first time it is used.`,
        'success'
      );

      await refreshPanel();
    });
  });

  return el('div', { className: 'section-header', children: [el('h4', { text: 'Configured' }), detect] });
}

function buildList(): HTMLElement {
  if (tools.length === 0) {
    return el('ul', {
      className: 'worktree-list',
      children: [el('li', { className: 'empty-state', text: 'No tools configured' })]
    });
  }

  return el('ul', {
    className: 'worktree-list',
    children: tools.map((tool) => buildRow(tool))
  });
}

function buildRow(tool: ExternalToolDefinition): HTMLLIElement {
  const remove = el('button', {
    className: 'btn btn-icon btn-sm btn-text-danger',
    title: `Remove ${tool.label}`,
    children: [icon('delete', 14)]
  }) as HTMLButtonElement;

  remove.addEventListener('click', () => {
    void withButtonBusy(remove, async () => {
      await api.deleteTool(tool.id);
      await refreshPanel();
    });
  });

  const state: string[] = [tool.kind];
  if (tool.detected) {
    state.push('detected');
  }
  if (confirmed[tool.kind] === true) {
    state.push('confirmed');
  }
  if (!tool.enabled) {
    state.push('disabled');
  }

  return el('li', {
    className: `worktree-item${tool.enabled ? '' : ' agent-disabled'}`,
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: `${tool.label} · ${state.join(' · ')}` }),
          el('span', {
            className: 'worktree-meta',
            // The template as configured, so it can be checked at a glance.
            text: [tool.executable, ...tool.args].join(' ')
          })
        ]
      }),
      el('span', { className: 'worktree-actions', children: [remove] })
    ]
  }) as HTMLLIElement;
}

function buildEditor(): HTMLElement {
  const kind = el('select') as HTMLSelectElement;
  for (const value of EXTERNAL_TOOL_KINDS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    kind.appendChild(option);
  }

  const label = el('input', { attrs: { type: 'text', placeholder: 'WinMerge' } }) as HTMLInputElement;
  const executable = el('input', {
    attrs: { type: 'text', placeholder: 'WinMergeU' }
  }) as HTMLInputElement;
  const args = el('input', {
    attrs: { type: 'text', placeholder: '/e /u {local} {remote}' }
  }) as HTMLInputElement;

  const save = el('button', {
    className: 'btn btn-primary btn-sm',
    children: [icon('save', 16), el('span', { text: 'Save tool' })]
  }) as HTMLButtonElement;

  save.addEventListener('click', () => {
    void withButtonBusy(save, async () => {
      try {
        await api.saveTool({
          kind: kind.value as ExternalToolKind,
          label: label.value.trim() || executable.value.trim(),
          executable: executable.value.trim(),
          // Split into an argument vector here and kept separate all the way to
          // spawn. Placeholders are substituted within an element, never across.
          args: args.value.split(/\s+/).filter((value) => value !== ''),
          enabled: true
        });

        showToast('Tool saved', 'success');
        await refreshPanel();
      } catch (error) {
        // An unknown placeholder is refused while the form is still open,
        // rather than at the moment someone tries to open a diff.
        showToast(errorMessage(error), 'error', 8000);
      }
    });
  });

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'Add or edit' })] }),
      el('div', {
        className: 'worktree-form',
        children: [
          el('div', { className: 'form-row', children: [el('label', { text: 'Kind' }), kind] }),
          el('div', { className: 'form-row', children: [el('label', { text: 'Name' }), label] }),
          el('div', {
            className: 'form-row',
            children: [el('label', { text: 'Executable' }), executable]
          }),
          el('div', { className: 'form-row', children: [el('label', { text: 'Arguments' }), args] })
        ]
      }),
      el('div', { className: 'btn-group', children: [save] })
    ]
  });
}

function buildShellIntegration(): HTMLElement {
  if (!shellStatus) {
    return el('section', {
      children: [
        el('div', {
          className: 'section-header',
          children: [el('h4', { text: 'Windows Explorer' })]
        }),
        el('p', {
          className: 'modal-desc',
          text: 'Explorer integration is only available in the desktop app.'
        })
      ]
    });
  }

  if (!shellStatus.supported) {
    return el('section', {
      children: [
        el('div', {
          className: 'section-header',
          children: [el('h4', { text: 'Windows Explorer' })]
        }),
        el('p', { className: 'modal-desc', text: shellStatus.reason ?? 'Not available here.' })
      ]
    });
  }

  const action = el('button', {
    className: `btn btn-sm ${shellStatus.installed ? 'btn-danger' : 'btn-secondary'}`,
    text: shellStatus.installed ? 'Remove entries' : 'Install entries'
  }) as HTMLButtonElement;

  action.addEventListener('click', () => {
    void withButtonBusy(action, () => toggleShellIntegration());
  });

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [el('h4', { text: 'Windows Explorer' })]
      }),
      el('p', {
        className: 'modal-desc',
        text: shellStatus.installed
          ? 'Right-clicking a folder in Explorer offers to open it in Multi-Git. Removing deletes exactly the keys listed below and nothing else.'
          : 'Adds “Open in Multi-Git” to the Explorer right-click menu for folders. It writes only these two keys, under your own user — no administrator rights, and no file associations are claimed.'
      }),
      // The exact keys, before anything is written. This is the only part of
      // the application that writes outside its own configuration.
      el('ul', {
        className: 'placeholder-help',
        children: shellStatus.keys.map((key) => el('li', { children: [el('code', { text: key })] }))
      }),
      el('div', { className: 'btn-group', children: [action] })
    ]
  });
}

async function toggleShellIntegration(): Promise<void> {
  const desktop = window.desktopApi;
  if (!desktop || !shellStatus) {
    return;
  }

  const installing = !shellStatus.installed;

  const { confirmed: agreed } = await confirmDialog(
    installing
      ? `These registry keys will be created under your user account:\n\n${shellStatus.keys.join('\n')}`
      : `These registry keys will be deleted:\n\n${shellStatus.keys.join('\n')}`,
    {
      title: installing ? 'Install Explorer entries' : 'Remove Explorer entries',
      confirmLabel: installing ? 'Install' : 'Remove',
      danger: !installing
    }
  );

  if (!agreed) {
    return;
  }

  try {
    shellStatus = installing
      ? await desktop.installShellIntegration()
      : await desktop.removeShellIntegration();

    showToast(installing ? 'Explorer entries installed' : 'Explorer entries removed', 'success');
    await refreshPanel();
  } catch (error) {
    showToast(errorMessage(error), 'error', 8000);
  }
}

async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-tools');
  if (panel) {
    await renderPanel(panel);
  }
}
