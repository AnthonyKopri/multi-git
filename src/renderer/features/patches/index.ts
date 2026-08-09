// The Patches tab: create one, or apply one.
//
// Applying is the half that can damage a working tree, so it is arranged so
// that the dry run is the easy path and the real apply is a second, deliberate
// press. The server refuses a patch that writes outside the repository before
// either of them runs.
import * as api from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { el, icon } from '../../dom/create';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab } from '../repo-hub';
import type { AmState, PatchPreview, WhitespacePolicy } from '../../../shared/patch-types';

let preview: PatchPreview | null = null;
let amState: AmState = { inProgress: false };

export function initPatches(): void {
  registerHubTab('patches', { render: renderPanel });
}

async function renderPanel(panel: HTMLElement): Promise<void> {
  try {
    amState = (await api.getAmState()).state;
  } catch {
    amState = { inProgress: false };
  }

  panel.replaceChildren(
    ...(amState.inProgress ? [buildAmControls()] : []),
    buildCreate(),
    buildApply()
  );
}

/**
 * The controls for a `git am` that stopped part-way.
 *
 * Shown first and only when relevant: a stopped series is a state the
 * repository is in, and every other action in this tab is a bad idea until it
 * is resolved.
 */
function buildAmControls(): HTMLElement {
  const buttons = (['continue', 'skip', 'abort'] as const).map((action) => {
    const button = el('button', {
      className: `btn btn-sm ${action === 'abort' ? 'btn-danger' : 'btn-secondary'}`,
      text: action
    }) as HTMLButtonElement;

    button.addEventListener('click', () => {
      void withButtonBusy(button, async () => {
        try {
          amState = (await api.controlAm(action)).state;
          showToast(`git am --${action} done`, 'success');
          await refreshPanel();
        } catch (error) {
          showToast(errorMessage(error), 'error');
        }
      });
    });

    return button;
  });

  const position =
    amState.current !== undefined && amState.total !== undefined
      ? ` (${amState.current} of ${amState.total})`
      : '';

  return el('div', {
    className: 'inline-warning',
    children: [
      el('p', {
        text: `A patch series is part-way through${position}. Resolve the conflicts and continue, skip this patch, or abort the whole series.`
      }),
      el('div', { className: 'btn-group', children: buttons })
    ]
  });
}

function selectRow(
  label: string,
  options: { value: string; text: string }[]
): { row: HTMLElement; select: HTMLSelectElement } {
  const select = el('select') as HTMLSelectElement;
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.text;
    select.appendChild(element);
  }

  return {
    row: el('div', { className: 'form-row', children: [el('label', { text: label }), select] }),
    select
  };
}

function textRow(
  label: string,
  placeholder = '',
  value = ''
): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { attrs: { type: 'text', placeholder } }) as HTMLInputElement;
  input.value = value;

  return {
    row: el('div', { className: 'form-row', children: [el('label', { text: label }), input] }),
    input
  };
}

function buildCreate(): HTMLElement {
  const source = selectRow('From', [
    { value: 'commits', text: 'Commits' },
    { value: 'working', text: 'Uncommitted changes' },
    { value: 'staged', text: 'Staged changes' }
  ]);
  const format = selectRow('Format', [
    { value: 'mailbox', text: 'Mailbox (git am — keeps author, date and message)' },
    { value: 'diff', text: 'Plain diff (git apply — working-tree changes only)' }
  ]);
  const from = textRow('Commit or range start', 'HEAD', 'HEAD');
  const to = textRow('Range end', 'Leave empty for a single commit');

  const output = el('pre', { className: 'patch-preview' });

  const build = el('button', {
    className: 'btn btn-primary btn-sm',
    children: [icon('build', 16), el('span', { text: 'Build patch' })]
  }) as HTMLButtonElement;

  const save = el('button', {
    className: 'btn btn-secondary btn-sm',
    children: [icon('save', 16), el('span', { text: 'Save…' })]
  }) as HTMLButtonElement;
  save.disabled = true;

  const copy = el('button', {
    className: 'btn btn-secondary btn-sm',
    children: [icon('content_copy', 16), el('span', { text: 'Copy' })]
  }) as HTMLButtonElement;
  copy.disabled = true;

  build.addEventListener('click', () => {
    void withButtonBusy(build, async () => {
      try {
        const result = await api.createPatch({
          format: format.select.value as 'diff' | 'mailbox',
          from: from.input.value.trim() || 'HEAD',
          ...(to.input.value.trim() !== '' ? { to: to.input.value.trim() } : {}),
          source: source.select.value as 'commits' | 'working' | 'staged'
        });

        preview = result.preview;
        output.textContent = preview.text;
        save.disabled = false;
        copy.disabled = false;

        showToast(
          `${preview.paths.length} file(s), ${preview.byteLength} bytes${preview.hasBinary ? ' — contains binary' : ''}`,
          'success'
        );
      } catch (error) {
        preview = null;
        output.textContent = '';
        save.disabled = true;
        copy.disabled = true;
        showToast(errorMessage(error), 'error');
      }
    });
  });

  copy.addEventListener('click', () => void copyPatch());
  save.addEventListener('click', () => void savePatch());

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'Create a patch' })] }),
      el('div', {
        className: 'worktree-form',
        children: [source.row, format.row, from.row, to.row]
      }),
      el('div', { className: 'btn-group', children: [build, copy, save] }),
      output
    ]
  });
}

async function copyPatch(): Promise<void> {
  if (!preview) {
    return;
  }

  try {
    await navigator.clipboard.writeText(preview.text);
    showToast('Patch copied', 'success');
  } catch {
    logToTerminal(preview.text, 'info');
    showToast('Clipboard unavailable — written to the Terminal Log instead', 'info');
  }
}

async function savePatch(): Promise<void> {
  if (!preview) {
    return;
  }

  const desktop = window.desktopApi;

  if (desktop?.selectSaveFile && desktop.writeTextFile) {
    // The native dialog is also the authorisation: the main process will only
    // write to a path that came back from it.
    const filePath = await desktop.selectSaveFile({
      suggestedName: 'changes.patch',
      extension: 'patch'
    });

    if (filePath === '') {
      return;
    }

    await desktop.writeTextFile({ filePath, contents: preview.text });
    showToast(`Saved to ${filePath}`, 'success');
    return;
  }

  // Browser mode has no native dialog, so the download is the save.
  const blob = new Blob([preview.text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { attrs: { href: url, download: 'changes.patch' } }) as HTMLAnchorElement;

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildApply(): HTMLElement {
  const patch = el('textarea', {
    className: 'patch-input',
    attrs: { rows: '10', placeholder: 'Paste a patch here, or load one from a file' }
  }) as HTMLTextAreaElement;

  const load = el('input', {
    attrs: { type: 'file', accept: '.patch,.diff,text/plain' }
  }) as HTMLInputElement;

  load.addEventListener('change', () => {
    const file = load.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((text) => {
      patch.value = text;
    });
  });

  const mode = selectRow('Apply as', [
    { value: 'working', text: 'Working-tree changes (git apply)' },
    { value: 'commits', text: 'Commits, keeping author and message (git am)' }
  ]);
  const whitespace = selectRow('Whitespace', [
    { value: 'warn', text: 'Warn' },
    { value: 'nowarn', text: 'Ignore' },
    { value: 'fix', text: 'Fix' },
    { value: 'error', text: 'Refuse the patch' }
  ]);

  const threeWay = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const index = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;

  const check = el('button', {
    className: 'btn btn-secondary',
    children: [icon('fact_check', 16), el('span', { text: 'Check only' })]
  }) as HTMLButtonElement;

  const apply = el('button', {
    className: 'btn btn-primary',
    children: [icon('done_all', 16), el('span', { text: 'Apply' })]
  }) as HTMLButtonElement;

  const run = (dryRun: boolean, button: HTMLButtonElement): void => {
    void withButtonBusy(button, async () => {
      try {
        const { outcome } = await api.applyPatch({
          patch: patch.value,
          mode: mode.select.value as 'working' | 'commits',
          dryRun,
          whitespace: whitespace.select.value as WhitespacePolicy,
          threeWay: threeWay.checked,
          index: index.checked
        });

        if (outcome.conflicts && outcome.conflicts.length > 0) {
          // A three-way apply that leaves conflicts did what it was asked and
          // stopped for a human; it is not a failure.
          showToast(
            `Applied with conflicts in ${outcome.conflicts.length} file(s). Resolve them in the Staging Area.`,
            'info',
            8000
          );
        } else {
          showToast(
            dryRun
              ? `The patch applies cleanly to ${outcome.paths.length} file(s).`
              : `Applied to ${outcome.paths.length} file(s).`,
            'success'
          );
        }

        await refreshPanel();
      } catch (error) {
        showToast(errorMessage(error), 'error', 8000);
      }
    });
  };

  check.addEventListener('click', () => run(true, check));
  apply.addEventListener('click', () => run(false, apply));

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'Apply a patch' })] }),
      el('p', {
        className: 'modal-desc',
        text: 'A recovery point is saved before anything is written. A patch that would write outside this repository is refused.'
      }),
      load,
      patch,
      el('div', { className: 'worktree-form', children: [mode.row, whitespace.row] }),
      el('label', {
        className: 'amend-row',
        children: [threeWay, el('span', { text: 'Three-way merge, which may leave conflicts to resolve' })]
      }),
      el('label', {
        className: 'amend-row',
        children: [index, el('span', { text: 'Stage the result as well' })]
      }),
      el('div', { className: 'btn-group', children: [check, apply] })
    ]
  });
}

async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-patches');
  if (panel) {
    await renderPanel(panel);
  }
}
