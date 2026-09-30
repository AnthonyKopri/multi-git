// @vitest-environment happy-dom
//
// The progress bar in the clone dialog, and the clone flow that feeds it.
//
// The view is drawn from an operation the server publishes, so most of this
// hands it operations and reads the DOM back. The flow tests use the real
// index.html and stand in for the two things outside it: the clone request,
// which only answers when the clone is over, and the operations stream, which is
// where progress actually arrives.
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fromAppRoot } from '../src/server/app-root';
import { ApiError, api as client } from '../src/renderer/api/client';
import { resolveElements } from '../src/renderer/dom/elements';
import type { Elements } from '../src/renderer/dom/elements';
import {
  hideCloneProgress,
  newCloneOperationId,
  renderCloneProgress
} from '../src/renderer/features/repo/clone-progress';
import type { OperationProgress } from '../src/shared/operation-types';

const mocks = vi.hoisted(() => ({
  clone: vi.fn(),
  rememberRepo: vi.fn(),
  subscribe: vi.fn()
}));

vi.mock('../src/renderer/api/endpoints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/api/endpoints')>()),
  clone: mocks.clone,
  rememberRepo: mocks.rememberRepo
}));
vi.mock('../src/renderer/api/operations', () => ({ subscribeToOperations: mocks.subscribe }));
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn() }));
// The real logger posts each line to the server, which is not running here.
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));

let ui: Elements;

function mount(): void {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  ui = resolveElements();
}

function operation(overrides: Partial<OperationProgress> = {}): OperationProgress {
  return {
    id: 'clone-op-1',
    kind: 'git.clone',
    state: 'running',
    cancellable: false,
    message: 'Receiving objects',
    completed: 555,
    total: 1234,
    transfer: {
      fraction: 0.4,
      bytes: 1.2 * 1024 ** 2,
      bytesPerSecond: 2.5 * 1024 ** 2,
      remainingMs: 47_000
    },
    ...overrides
  };
}

const text = (element: HTMLElement): string => element.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mount();
});

describe('the clone progress bar', () => {
  it('is hidden until a clone starts', () => {
    expect(ui.cloneProgress.classList.contains('hidden')).toBe(true);
  });

  it('moves rather than sitting empty before there is anything to measure', () => {
    renderCloneProgress(ui, null);

    expect(ui.cloneProgress.classList.contains('hidden')).toBe(false);
    expect(ui.cloneProgressTrack.classList.contains('is-indeterminate')).toBe(true);
    expect(ui.cloneProgressTrack.hasAttribute('aria-valuenow')).toBe(false);
    expect(text(ui.cloneProgressStage)).toBe('Starting clone…');
    expect(text(ui.cloneProgressPercent)).toBe('');
  });

  it('shows the operation\'s own message while it has no figures yet', () => {
    renderCloneProgress(ui, operation({ message: 'Cloning repo', transfer: undefined }));

    expect(ui.cloneProgressTrack.classList.contains('is-indeterminate')).toBe(true);
    expect(text(ui.cloneProgressStage)).toBe('Cloning repo');
  });

  it('draws the whole-operation fraction, the phase, the counts and the speed', () => {
    renderCloneProgress(ui, operation());

    expect(ui.cloneProgressTrack.classList.contains('is-indeterminate')).toBe(false);
    expect(ui.cloneProgressBar.style.width).toBe('40%');
    expect(ui.cloneProgressTrack.getAttribute('aria-valuenow')).toBe('40');
    expect(text(ui.cloneProgressStage)).toBe('Receiving objects');
    expect(text(ui.cloneProgressPercent)).toBe('40%');
    expect(text(ui.cloneProgressDetail)).toBe(
      `${(555).toLocaleString()} / ${(1234).toLocaleString()} · 1.20 MiB · 2.50 MiB/s`
    );
    expect(text(ui.cloneProgressRemaining)).toBe('about 45s left');
  });

  it('shows how much of the expected total has arrived, marked as approximate', () => {
    renderCloneProgress(
      ui,
      operation({
        transfer: {
          fraction: 0.4,
          bytes: 7.5 * 1024 ** 2,
          bytesPerSecond: 1024 ** 2,
          expectedBytes: 37.4 * 1024 ** 2
        }
      })
    );

    expect(text(ui.cloneProgressDetail)).toContain('7.50 MiB of ~37.4 MiB · 1.00 MiB/s');
  });

  it('leaves the time blank while it is too early to guess', () => {
    renderCloneProgress(
      ui,
      operation({ transfer: { fraction: 0.05, bytes: 1024, bytesPerSecond: 1024 } })
    );

    expect(text(ui.cloneProgressRemaining)).toBe('');
  });

  it('leaves out the size and speed for a phase that has none', () => {
    renderCloneProgress(
      ui,
      operation({ message: 'Resolving deltas', completed: 3, total: 6, transfer: { fraction: 0.8 } })
    );

    expect(text(ui.cloneProgressDetail)).toBe('3 / 6');
  });

  it('does not read 100% until the work is done', () => {
    renderCloneProgress(ui, operation({ transfer: { fraction: 0.9999 } }));

    expect(text(ui.cloneProgressPercent)).toBe('99%');
  });

  it('does not lose a percent to floating point', () => {
    renderCloneProgress(ui, operation({ transfer: { fraction: 0.29 } }));

    expect(text(ui.cloneProgressPercent)).toBe('29%');
  });

  it('reads 100% once the clone has succeeded, even if git never wrote about its last phase', () => {
    // A checkout that finishes quickly prints nothing, so the last figure the
    // server had was the end of the deltas.
    renderCloneProgress(ui, operation({ state: 'succeeded', message: 'Cloned repo', transfer: { fraction: 0.9 } }));

    expect(text(ui.cloneProgressPercent)).toBe('100%');
    expect(ui.cloneProgressBar.style.width).toBe('100%');
  });

  it('goes away when the clone ends', () => {
    renderCloneProgress(ui, operation());
    hideCloneProgress(ui);

    expect(ui.cloneProgress.classList.contains('hidden')).toBe(true);
    expect(ui.cloneProgressBar.style.width).toBe('');
  });

  it('sits in the pinned footer, so the buttons and the bar are visible together', () => {
    const footer = ui.btnStartClone.closest('.form-dialog-actions');

    expect(footer).not.toBeNull();
    expect(footer?.contains(ui.cloneProgress)).toBe(true);
  });
});

describe('newCloneOperationId', () => {
  it('makes ids the server will accept, and different each time', () => {
    const ids = [newCloneOperationId(), newCloneOperationId()];

    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('starting a clone', () => {
  /** Puts the dialog in the state a user leaves it in before pressing Clone. */
  async function open() {
    const repo = await import('../src/renderer/features/repo');
    repo.initRepo(ui, { refreshAll: async () => {}, onOpened: () => {} });
    (ui.cloneUrlInput as HTMLInputElement).value = 'git@github.com:team/repo.git';
    (ui.cloneParentDirInput as HTMLInputElement).value = 'C:/code';
    return repo;
  }

  /** The listener the flow registered on the operations stream, once it has. */
  function listener(): (operations: OperationProgress[]) => void {
    const registered = mocks.subscribe.mock.calls[0]?.[0];
    expect(registered).toBeTypeOf('function');
    return registered;
  }

  beforeEach(() => {
    mocks.subscribe.mockReturnValue(vi.fn());
    mocks.rememberRepo.mockRejectedValue(new Error('not needed here'));
  });

  it('draws its own clone\'s progress and ignores anybody else\'s', async () => {
    const repo = await open();
    const seen: Record<string, string> = {};

    mocks.clone.mockImplementation(async (input: { operationId?: string }) => {
      expect(input.operationId).toMatch(/^[A-Za-z0-9-]{8,64}$/);

      // Another window's clone, and then this one.
      listener()([operation({ id: 'somebody-else', transfer: { fraction: 0.9 } })]);
      seen['other'] = text(ui.cloneProgressPercent);
      listener()([operation({ id: input.operationId as string })]);
      seen['own'] = text(ui.cloneProgressPercent);
      seen['visible'] = String(!ui.cloneProgress.classList.contains('hidden'));

      throw new ApiError('Remote hung up', 500);
    });

    await repo.startClone();

    expect(seen['other']).toBe('');
    expect(seen['own']).toBe('40%');
    expect(seen['visible']).toBe('true');
  });

  describe('the expected size', () => {
    const picked = {
      nameWithOwner: 'team/repo',
      description: '',
      url: 'https://github.com/team/repo',
      sshUrl: 'git@github.com:team/repo.git',
      isPrivate: false,
      isArchived: false,
      diskUsage: 38345
    };

    async function loadList(repositories: unknown[]) {
      vi.spyOn(client, 'get').mockResolvedValue({ repositories, atLimit: false });
      (document.getElementById('clone-load-repositories') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(document.querySelector('.clone-repository')).not.toBeNull());
    }

    it('is sent when the repository was picked from the GitHub list', async () => {
      const repo = await open();
      await loadList([picked]);
      mocks.clone.mockRejectedValue(new ApiError('stop here', 500));

      await repo.startClone();

      expect(mocks.clone).toHaveBeenCalledWith(expect.objectContaining({ expectedBytes: 38345 * 1024 }));
    });

    it('is left out for a URL that was pasted', async () => {
      const repo = await open();
      await loadList([picked]);
      (ui.cloneUrlInput as HTMLInputElement).value = 'https://example.com/somewhere/else.git';
      mocks.clone.mockRejectedValue(new ApiError('stop here', 500));

      await repo.startClone();

      expect(mocks.clone.mock.calls[0]?.[0]).not.toHaveProperty('expectedBytes');
    });
  });

  it('shows the starting state straight away, before the server has said anything', async () => {
    const repo = await open();
    let whileWaiting = '';

    mocks.clone.mockImplementation(async () => {
      whileWaiting = text(ui.cloneProgressStage);
      throw new ApiError('nope', 500);
    });

    await repo.startClone();

    expect(whileWaiting).toBe('Starting clone…');
  });

  it('hides the bar, stops listening and shows the reason when the clone fails', async () => {
    const repo = await open();
    const stop = vi.fn();
    mocks.subscribe.mockReturnValue(stop);
    mocks.clone.mockRejectedValue(new ApiError('Repository not found.', 404));

    await repo.startClone();

    expect(ui.cloneProgress.classList.contains('hidden')).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(text(ui.cloneFeedback)).toBe('Repository not found.');
    expect(ui.cloneFeedback.classList.contains('error')).toBe(true);
  });

  it('hides the bar and stops listening when the clone succeeds', async () => {
    const repo = await open();
    const stop = vi.fn();
    mocks.subscribe.mockReturnValue(stop);
    mocks.clone.mockResolvedValue({ success: true, repoPath: 'C:/code/repo', profileLabel: null });

    await repo.startClone();

    expect(ui.cloneProgress.classList.contains('hidden')).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(ui.cloneModal.classList.contains('hidden')).toBe(true);
  });

  it('clears an old error when a new attempt starts', async () => {
    const repo = await open();
    mocks.clone.mockRejectedValueOnce(new ApiError('first failure', 500));
    await repo.startClone();
    expect(text(ui.cloneFeedback)).toBe('first failure');

    let duringSecond = 'unset';
    mocks.clone.mockImplementationOnce(async () => {
      duringSecond = text(ui.cloneFeedback);
      throw new ApiError('second failure', 500);
    });
    await repo.startClone();

    expect(duringSecond).toBe('');
    expect(text(ui.cloneFeedback)).toBe('second failure');
  });

  it('asks for nothing and shows nothing when the form is incomplete', async () => {
    const repo = await open();
    (ui.cloneUrlInput as HTMLInputElement).value = '';

    await repo.startClone();

    expect(mocks.clone).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(ui.cloneProgress.classList.contains('hidden')).toBe(true);
  });
});
