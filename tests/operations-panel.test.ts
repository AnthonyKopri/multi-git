// @vitest-environment happy-dom
//
// The operations bar, against the real index.html.
//
// The claim this file exists to protect is structural: the bar has to sit
// outside <main>, because <main> is blurred and made pointer-events: none while
// an operation blocks the app. A bar nested inside it would render a Cancel
// button nobody could click, and no amount of behavioural testing of the button
// itself would catch that.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { OperationProgress } from '../src/shared/operation-types';

const operationsApi = vi.hoisted(() => ({
  subscribeToOperations: vi.fn(),
  cancelOperation: vi.fn(),
  listOperations: vi.fn(() => []),
  activeOperations: vi.fn(() => []),
  fetchOperations: vi.fn(),
  resetOperations: vi.fn()
}));

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../src/renderer/api/operations', () => operationsApi);
vi.mock('../src/renderer/ui/toast', () => toast);
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));

/** The listener the feature registered, so a test can push events at it. */
let publish: (operations: OperationProgress[]) => void = () => {};

async function mount() {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  vi.resetModules();
  vi.clearAllMocks();
  operationsApi.subscribeToOperations.mockImplementation((listener: typeof publish) => {
    publish = listener;
    listener([]);
    return () => {};
  });

  const { resolveElements } = await import('../src/renderer/dom/elements');
  const feature = await import('../src/renderer/features/operations');

  feature.initOperations(resolveElements());
  return feature;
}

function operation(overrides: Partial<OperationProgress> = {}): OperationProgress {
  return {
    id: 'op-1',
    kind: 'git.push',
    repoPath: 'D:\\work\\app',
    state: 'running',
    message: 'Pushing main',
    cancellable: true,
    ...overrides
  };
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

beforeEach(async () => {
  await mount();
});

describe('where the bar lives', () => {
  it('sits outside the main body, so it stays clickable while one blocks', () => {
    const bar = $('operations-bar');
    const main = $('main-content');

    // The busy overlay is `.main-body.disabled-view`: blurred, pointer-events
    // none. Anything inside it cannot be cancelled from.
    expect(main.contains(bar)).toBe(false);
    expect(bar.closest('#main-content')).toBeNull();
    expect(bar.parentElement?.id).toBe('app');
  });

  it('survives the main body being disabled', () => {
    $('main-content').classList.add('disabled-view');

    expect($('operations-bar').closest('.disabled-view')).toBeNull();
  });
});

describe('the summary line', () => {
  it('starts idle', () => {
    expect($('operations-bar').dataset['state']).toBe('idle');
    expect($('operations-headline').textContent).toBe('Nothing running');
  });

  it('names what is running', () => {
    publish([operation()]);

    expect($('operations-bar').dataset['state']).toBe('running');
    expect($('operations-headline').textContent).toBe('Pushing main');
  });

  it('counts the rest only when there is more than one', () => {
    publish([operation()]);
    expect($('operations-count').classList.contains('hidden')).toBe(true);

    publish([operation(), operation({ id: 'op-2', message: 'Fetching origin' })]);
    expect($('operations-count').textContent).toBe('+1');
    expect($('operations-count').classList.contains('hidden')).toBe(false);
  });

  it('goes back to idle when everything has finished', () => {
    publish([operation()]);
    publish([operation({ state: 'succeeded' })]);

    expect($('operations-bar').dataset['state']).toBe('idle');
  });
});

describe('the list', () => {
  it('is collapsed until asked for', () => {
    expect($('operations-panel').classList.contains('hidden')).toBe(true);
    expect($('operations-summary').getAttribute('aria-expanded')).toBe('false');

    $('operations-summary').click();

    expect($('operations-panel').classList.contains('hidden')).toBe(false);
    expect($('operations-summary').getAttribute('aria-expanded')).toBe('true');
  });

  it('puts what is still running above what has finished', () => {
    $('operations-summary').click();
    publish([
      operation({ id: 'done', state: 'succeeded', message: 'Finished earlier' }),
      operation({ id: 'live', state: 'running', message: 'Still going' })
    ]);

    const rows = [...$('operations-list').querySelectorAll('.operation-row')];
    expect(rows[0]?.textContent).toContain('Still going');
    expect(rows[1]?.textContent).toContain('Finished earlier');
  });

  it('offers Cancel only while an operation is running and says it can be', () => {
    $('operations-summary').click();
    publish([
      operation({ id: 'live' }),
      operation({ id: 'uncancellable', cancellable: false, message: 'Writing config' }),
      operation({ id: 'done', state: 'succeeded', message: 'Finished' })
    ]);

    const cancels = [...$('operations-list').querySelectorAll('[data-action="cancel"]')].map(
      (button) => (button as HTMLElement).dataset['operationId']
    );

    // An uncancellable operation must not offer a control that does nothing.
    expect(cancels).toEqual(['live']);
  });

  it('shows several repositories at once without mixing them up', () => {
    $('operations-summary').click();
    publish([
      operation({ id: 'a', repoPath: 'D:\\work\\one', message: 'Pushing one' }),
      operation({ id: 'b', repoPath: 'D:\\work\\two', message: 'Pushing two' })
    ]);

    const text = $('operations-list').textContent ?? '';
    expect(text).toContain('D:\\work\\one');
    expect(text).toContain('D:\\work\\two');
  });
});

describe('cancelling', () => {
  it('asks the server, and says server-side effects may already have happened', async () => {
    operationsApi.cancelOperation.mockResolvedValue(true);
    $('operations-summary').click();
    publish([operation({ id: 'live' })]);

    ($('operations-list').querySelector('[data-action="cancel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(operationsApi.cancelOperation).toHaveBeenCalledWith('live'));

    // Cancelling a push is not undoing one, and the message must not imply it.
    const [message] = toast.showToast.mock.calls.at(-1) ?? [];
    expect(String(message)).toMatch(/already been sent|already/i);
  });

  it('says so plainly when the operation had already finished', async () => {
    operationsApi.cancelOperation.mockResolvedValue(false);
    $('operations-summary').click();
    publish([operation({ id: 'live' })]);

    ($('operations-list').querySelector('[data-action="cancel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(toast.showToast).toHaveBeenCalled());

    const [message] = toast.showToast.mock.calls.at(-1) ?? [];
    expect(String(message)).toMatch(/already finished/i);
  });

  it('ignores a click that is not on an action', () => {
    $('operations-summary').click();
    publish([operation({ id: 'live' })]);

    ($('operations-list').querySelector('.worktree-name') as HTMLElement).click();

    expect(operationsApi.cancelOperation).not.toHaveBeenCalled();
  });
});

describe('diagnostics', () => {
  it('copies only fields the registry publishes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    $('operations-summary').click();
    publish([operation({ id: 'live', total: 4, completed: 2 })]);

    ($('operations-list').querySelector('[data-action="copy"]') as HTMLElement).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());

    const copied = String(writeText.mock.calls[0]?.[0] ?? '');
    expect(copied).toContain('kind: git.push');
    expect(copied).toContain('progress: 2/4');
    // Those fields are redacted by the runner before they ever reach the
    // registry, so there is no second redaction step here to forget.
    expect(copied).toContain('id: live');
  });
});
