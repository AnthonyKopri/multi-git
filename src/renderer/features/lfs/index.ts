// The Git LFS tab, and the sidebar summary beside it.
//
// The panel is arranged around one distinction: a file tracked by LFS is
// committed as a small pointer, and the real bytes may or may not be on this
// machine. "The file is here" and "the file's contents are here" are different
// facts, so an object that is only a pointer says so and offers to fetch rather
// than pretending it can be opened.
//
// When LFS is not installed the panel says exactly that and links the install
// page. An empty object list would read as "this repository has no large
// files", which is a different and much more misleading answer.
import * as api from '../../api/endpoints';
import { ApiError, errorMessage, isStale } from '../../api/client';
import { el, icon } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import { getState } from '../../state/store';
import { confirmDialog, promptDialog } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import { registerHubTab } from '../repo-hub';
import type {
  LfsInstallAction,
  LfsLock,
  LfsObject,
  LfsStatus
} from '../../../shared/lfs-types';

let ui: Elements;
let status: LfsStatus | null = null;

export function initLfs(elements: Elements): void {
  ui = elements;
  registerHubTab('lfs', { render: renderPanel });
}

// ---------- the sidebar summary ----------

export async function refreshLfs(): Promise<void> {
  if (!getState().activeRepo) {
    status = null;
    renderSummary();
    return;
  }

  try {
    status = (await api.getLfsStatus()).status;
  } catch (error) {
    if (!isStale(error)) {
      // Not installed is a normal answer, not something to log as an error.
      // The server's structured code is what distinguishes it; matching on the
      // message text would break the first time the wording changed.
      if (!(error instanceof ApiError && error.details['code'] === 'LFS_MISSING')) {
        logToTerminal(`Could not read Git LFS state: ${errorMessage(error)}`, 'error');
      }
    }
    status = null;
  }

  renderSummary();
}

function renderSummary(): void {
  if (!status) {
    ui.lfsSummary.replaceChildren(el('span', { className: 'empty-state', text: 'Not available' }));
    return;
  }

  // Surfaced ahead of everything else, and in both the installed and the
  // not-installed case: hooks that slow every pull down for no benefit are
  // something to be told about, not something to find by opening a tab you had
  // no reason to open.
  if (status.installation.redundant) {
    ui.lfsSummary.replaceChildren(
      el('span', { className: 'warn-state', text: 'LFS hooks installed but unused' }),
      el('span', { text: 'They run on every pull. Open the LFS tab to remove them.' })
    );
    return;
  }

  if (!status.availability.installed) {
    ui.lfsSummary.replaceChildren(
      el('span', { className: 'empty-state', text: 'Git LFS is not installed' })
    );
    return;
  }

  if (!status.availability.configured) {
    ui.lfsSummary.replaceChildren(
      el('span', { className: 'empty-state', text: 'Not used by this repository' })
    );
    return;
  }

  const missing = status.objects.filter((object) => !object.present).length;

  ui.lfsSummary.replaceChildren(
    el('span', { text: `${status.objects.length} tracked file(s)` }),
    el('span', {
      text:
        missing === 0
          ? 'all objects downloaded'
          : `${missing} not downloaded (pointer only)`
    }),
    ...(status.locks.length > 0 ? [el('span', { text: `${status.locks.length} lock(s)` })] : [])
  );
}

// ---------- the hub tab ----------

async function renderPanel(panel: HTMLElement): Promise<void> {
  await refreshLfs();

  if (!status || !status.availability.installed) {
    // Still offers the repository section: hooks left behind by a machine that
    // did have LFS are the reason pulls are slow here, and they can be removed
    // without the program.
    panel.replaceChildren(
      buildMissingNotice(),
      ...(status?.installation.installed ? [buildInstallation()] : [])
    );
    return;
  }

  panel.replaceChildren(
    el('p', {
      className: 'modal-desc',
      text: `Git LFS ${status.availability.version ?? ''} keeps large files out of the repository itself. Each tracked file is committed as a pointer; the real bytes are fetched separately, which is why some may be listed here without being downloaded.`
    }),
    buildInstallation(),
    buildPatterns(),
    buildTransfers(),
    buildObjects(),
    buildLocks()
  );
}

/**
 * The repository section: is LFS wired in here, and should it be.
 *
 * Separate from the tracked-pattern list because they answer different
 * questions. `git lfs install` writes four hooks that run on every pull, merge,
 * checkout and commit whether or not a single file is tracked — and on an SSH
 * remote those hooks shell out to ssh for an endpoint token, so a repository
 * with no large files in it can still sit waiting on a passphrase prompt under
 * a line that says Git LFS. Somewhere to see that, and a button to undo it, is
 * the whole point of this section.
 */
function buildInstallation(): HTMLElement {
  const installation = status?.installation;

  if (!installation) {
    return el('section');
  }

  const detail = installation.installed
    ? [
        installation.hooks.length > 0
          ? `hooks: ${installation.hooks.join(', ')}`
          : 'no hooks',
        installation.localFilters ? 'repository-local filters set' : 'no repository-local filters'
      ].join(' · ')
    : 'No LFS hooks and no repository-local filters. Git runs here without involving LFS at all.';

  const children: HTMLElement[] = [
    el('div', {
      className: 'section-header',
      children: [
        el('h4', {
          text: `This repository — ${installation.installed ? 'LFS is installed' : 'LFS is not installed'}`
        }),
        installation.installed ? uninstallButton() : installButton()
      ]
    }),
    el('p', { className: 'modal-desc', text: detail })
  ];

  if (installation.redundant) {
    children.push(
      el('div', {
        className: 'inline-warning',
        children: [
          el('p', {
            text: 'These hooks are doing nothing useful. No file in this repository is routed through LFS, and no LFS objects are present, yet the hooks still run on every pull, merge, checkout and commit.'
          }),
          el('p', {
            text: 'On an SSH remote they also ask ssh for an LFS token, which is why a pull can appear to hang on Git LFS in a repository that has no large files. Removing them is safe and affects this repository only.'
          })
        ]
      })
    );
  }

  return el('section', { children });
}

function installButton(): HTMLButtonElement {
  const button = el('button', {
    className: 'btn btn-secondary btn-sm',
    title: 'Run git lfs install --local, which writes this repository’s LFS hooks and filters',
    children: [icon('add', 16), el('span', { text: 'Enable LFS here' })]
  }) as HTMLButtonElement;

  button.addEventListener('click', () => {
    void withButtonBusy(button, () => changeInstallation('install'));
  });

  return button;
}

function uninstallButton(): HTMLButtonElement {
  const button = el('button', {
    className: 'btn btn-secondary btn-sm',
    title: 'Run git lfs uninstall --local, which removes this repository’s LFS hooks and filters',
    children: [icon('delete', 16), el('span', { text: 'Disable LFS here' })]
  }) as HTMLButtonElement;

  button.addEventListener('click', () => {
    void withButtonBusy(button, () => changeInstallation('uninstall'));
  });

  return button;
}

async function changeInstallation(action: LfsInstallAction): Promise<void> {
  const installation = status?.installation;

  // Confirmed only when it could lose something. Removing hooks from a
  // repository that genuinely routes files through LFS leaves those files
  // checked out as pointer text, which is worth a sentence first; removing
  // hooks that track nothing is not.
  if (action === 'uninstall' && installation && !installation.redundant) {
    const { confirmed } = await confirmDialog(
      'This repository does route files through LFS. Removing the hooks means git will no longer replace pointers with the real files on checkout, and pushes will not upload new LFS objects.\n\nOnly this repository is affected; other repositories and the global configuration are left alone.',
      { title: 'Disable Git LFS here', confirmLabel: 'Disable', danger: true }
    );

    if (!confirmed) {
      return;
    }
  }

  try {
    const { installation: next } = await api.setLfsInstallation(action);

    showToast(
      next.installed
        ? 'Git LFS is now installed in this repository.'
        : 'Git LFS hooks and filters removed from this repository.',
      'success'
    );
    logToTerminal(`git lfs ${action} --local`, 'cmd');

    await refreshPanel();
  } catch (error) {
    showToast(errorMessage(error), 'error', 8000);
  }
}

function buildMissingNotice(): HTMLElement {
  // Deliberately not an empty list: the two look identical and mean opposite
  // things.
  return el('div', {
    className: 'inline-warning',
    children: [
      el('p', {
        text: 'Git LFS is not installed, or is not on this application’s PATH. Multi-Git does not install it for you.'
      }),
      el('p', { text: 'Install it from https://git-lfs.com, then reopen this tab.' })
    ]
  });
}

function buildPatterns(): HTMLElement {
  const patterns = status?.trackedPatterns ?? [];

  const list = el('ul', {
    className: 'worktree-list',
    children:
      patterns.length === 0
        ? [el('li', { className: 'empty-state', text: 'No patterns tracked' })]
        : patterns.map((pattern) =>
            el('li', {
              className: 'worktree-item',
              children: [
                el('div', {
                  className: 'worktree-main',
                  children: [el('span', { className: 'worktree-name', text: pattern })]
                }),
                el('span', {
                  className: 'worktree-actions',
                  children: [
                    action('delete', `Stop tracking ${pattern}`, async (button) => {
                      await withButtonBusy(button, async () => {
                        await api.untrackLfsPattern(pattern);
                        showToast(`No longer tracking ${pattern}`, 'success');
                        await refreshPanel();
                      });
                    }, true)
                  ]
                })
              ]
            })
          )
  });

  const add = el('button', {
    className: 'btn btn-secondary btn-sm',
    children: [icon('add', 16), el('span', { text: 'Track a pattern' })]
  }) as HTMLButtonElement;

  add.addEventListener('click', () => {
    void (async () => {
      const pattern = await promptDialog({
        title: 'Track a pattern with Git LFS',
        label: 'Pattern, such as *.psd or assets/**',
        type: 'text'
      });

      if (pattern === null || pattern.trim() === '') {
        return;
      }

      try {
        await api.trackLfsPattern(pattern.trim());
        showToast(`Tracking ${pattern.trim()}`, 'success');
        await refreshPanel();
      } catch (error) {
        showToast(errorMessage(error), 'error');
      }
    })();
  });

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [el('h4', { text: 'Tracked patterns' }), add]
      }),
      list
    ]
  });
}

function buildTransfers(): HTMLElement {
  const buttons = (['fetch', 'pull', 'prune'] as const).map((transferAction) => {
    const button = el('button', {
      className: 'btn btn-secondary btn-sm',
      title:
        transferAction === 'fetch'
          ? 'Download the objects for the current branch without touching the working tree'
          : transferAction === 'pull'
            ? 'Fetch, then replace the pointers in the working tree with the real files'
            : 'Delete local objects that are no longer needed',
      children: [el('span', { text: transferAction })]
    }) as HTMLButtonElement;

    button.addEventListener('click', () => {
      void withButtonBusy(button, () => confirmTransfer(transferAction));
    });

    return button;
  });

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'Transfers' })] }),
      el('p', {
        className: 'modal-desc',
        text: 'Each of these shows what it would move before it moves anything, and can be cancelled from the operations bar while it runs.'
      }),
      el('div', { className: 'btn-group', children: buttons })
    ]
  });
}

async function confirmTransfer(transferAction: 'fetch' | 'pull' | 'prune'): Promise<void> {
  try {
    // Previewed first, always. An LFS object is large by definition, and a
    // transfer nobody asked the size of is how a metered connection gets used up.
    const { preview } = await api.previewLfsTransfer(transferAction);

    if (preview.objectCount === 0) {
      showToast(`Nothing for ${transferAction} to do`, 'info');
      return;
    }

    const size =
      preview.totalBytes > 0 ? ` (${formatBytes(preview.totalBytes)})` : '';
    const sample =
      preview.samplePaths.length > 0 ? `\n\n${preview.samplePaths.slice(0, 10).join('\n')}` : '';

    const { confirmed } = await confirmDialog(
      `${transferAction} would affect ${preview.objectCount} object(s)${size}.${sample}`,
      {
        title: `Git LFS ${transferAction}`,
        confirmLabel: transferAction,
        danger: transferAction === 'prune'
      }
    );

    if (!confirmed) {
      return;
    }

    const { cancelled } = await api.runLfsTransfer(transferAction);
    showToast(cancelled ? `${transferAction} cancelled` : `${transferAction} finished`, cancelled ? 'info' : 'success');
    await refreshPanel();
  } catch (error) {
    // LFS failures carry their own code, so this never reads as a git failure.
    showToast(errorMessage(error), 'error', 8000);
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function buildObjects(): HTMLElement {
  const objects = status?.objects ?? [];
  const missing = objects.filter((object) => !object.present);

  return el('section', {
    children: [
      el('div', {
        className: 'section-header',
        children: [
          el('h4', {
            text: `Objects — ${objects.length} tracked, ${missing.length} not downloaded`
          })
        ]
      }),
      el('ul', {
        className: 'worktree-list',
        children:
          objects.length === 0
            ? [el('li', { className: 'empty-state', text: 'No LFS objects in this checkout' })]
            : objects.slice(0, 200).map((object) => buildObjectRow(object))
      }),
      ...(objects.length > 200
        ? [
            el('p', {
              className: 'modal-desc',
              text: `Showing the first 200 of ${objects.length}.`
            })
          ]
        : [])
    ]
  });
}

function buildObjectRow(object: LfsObject): HTMLLIElement {
  return el('li', {
    className: `worktree-item${object.present ? '' : ' lfs-pointer-only'}`,
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: object.path, title: object.path }),
          el('span', {
            className: 'worktree-meta',
            // The size comes from the pointer, so it is known even for an
            // object that was never downloaded.
            text: `${formatBytes(object.size)} · ${object.present ? 'downloaded' : 'pointer only'}`
          })
        ]
      }),
      el('span', {
        className: 'worktree-actions',
        children: [
          action('lock', `Lock ${object.path} so others are warned off it`, async (button) => {
            await withButtonBusy(button, async () => {
              try {
                await api.createLfsLock(object.path);
                showToast(`Locked ${object.path}`, 'success');
                await refreshPanel();
              } catch (error) {
                showToast(errorMessage(error), 'error');
              }
            });
          })
        ]
      })
    ]
  }) as HTMLLIElement;
}

function buildLocks(): HTMLElement {
  const locks = status?.locks ?? [];

  if (status?.locksUnavailable) {
    return el('section', {
      children: [
        el('div', { className: 'section-header', children: [el('h4', { text: 'Locks' })] }),
        // Locking is optional in the LFS spec, so a server without it is a
        // fact rather than a fault.
        el('p', { className: 'modal-desc', text: status.locksUnavailable })
      ]
    });
  }

  return el('section', {
    children: [
      el('div', { className: 'section-header', children: [el('h4', { text: 'Locks' })] }),
      el('ul', {
        className: 'worktree-list',
        children:
          locks.length === 0
            ? [el('li', { className: 'empty-state', text: 'Nothing is locked' })]
            : locks.map((lock) => buildLockRow(lock))
      })
    ]
  });
}

function buildLockRow(lock: LfsLock): HTMLLIElement {
  return el('li', {
    className: 'worktree-item',
    children: [
      el('div', {
        className: 'worktree-main',
        children: [
          el('span', { className: 'worktree-name', text: lock.path, title: lock.path }),
          el('span', {
            className: 'worktree-meta',
            text: `${lock.mine ? 'yours' : lock.owner}${lock.lockedAt ? ` · ${lock.lockedAt}` : ''}`
          })
        ]
      }),
      el('span', {
        className: 'worktree-actions',
        children: [
          lock.mine
            ? action('lock_open', 'Release this lock', async (button) => {
                await withButtonBusy(button, async () => {
                  try {
                    await api.releaseLfsLock(lock.path, false);
                    showToast(`Released ${lock.path}`, 'success');
                    await refreshPanel();
                  } catch (error) {
                    showToast(errorMessage(error), 'error');
                  }
                });
              })
            : action('lock_open', `Force-release ${lock.owner}’s lock`, () => confirmForceUnlock(lock), true)
        ]
      })
    ]
  }) as HTMLLIElement;
}

async function confirmForceUnlock(lock: LfsLock): Promise<void> {
  // Force-unlock takes something away from another person, so it is never a
  // silent retry of a refused plain unlock.
  const { confirmed } = await confirmDialog(
    `${lock.path} is locked by ${lock.owner}. Forcing the lock open lets you change a file someone else has claimed, and they are not told. Continue?`,
    { title: 'Force-release a lock', confirmLabel: 'Force release', danger: true }
  );

  if (!confirmed) {
    return;
  }

  try {
    await api.releaseLfsLock(lock.path, true);
    showToast(`Force-released ${lock.path}`, 'success');
    await refreshPanel();
  } catch (error) {
    showToast(errorMessage(error), 'error', 8000);
  }
}

function action(
  glyph: string,
  title: string,
  run: (button: HTMLButtonElement) => void | Promise<void>,
  danger = false
): HTMLButtonElement {
  const button = el('button', {
    className: `btn btn-icon btn-sm${danger ? ' btn-text-danger' : ''}`,
    title,
    children: [icon(glyph, 14)]
  }) as HTMLButtonElement;

  button.addEventListener('click', () => void run(button));
  return button;
}

async function refreshPanel(): Promise<void> {
  const panel = document.getElementById('hub-panel-lfs');
  if (panel) {
    await renderPanel(panel);
  }
}
