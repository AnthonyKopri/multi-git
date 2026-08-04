import { describe, expect, it } from 'vitest';

import {
  COMPLETED_RETENTION_MS,
  MAX_COMPLETED_RETAINED,
  OperationRegistry
} from '../src/server/operations/registry';
import { createExecutableRunner } from '../src/server/process/runner';
import type { OperationProgress } from '../src/shared/operation-types';

/** A registry with readable ids, so assertions do not carry a UUID. */
function registry(): OperationRegistry {
  let counter = 0;
  return new OperationRegistry(() => `op-${++counter}`);
}

describe('the operation registry', () => {
  it('registers an operation as queued and lists it', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.fetch', repoPath: '/repo' });

    expect(handle.id).toBe('op-1');
    expect(operations.list()).toEqual([
      { id: 'op-1', kind: 'git.fetch', repoPath: '/repo', state: 'queued', cancellable: true }
    ]);
  });

  it('moves through running to succeeded', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.push' });

    handle.start('Pushing');
    expect(operations.get('op-1')).toMatchObject({ state: 'running', message: 'Pushing' });

    handle.succeed('Pushed 3 commits');
    expect(operations.get('op-1')).toMatchObject({
      state: 'succeeded',
      message: 'Pushed 3 commits'
    });
  });

  it('records a failure with its message', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.pull' });

    handle.start();
    handle.fail('could not resolve host');

    expect(operations.get('op-1')).toMatchObject({
      state: 'failed',
      message: 'could not resolve host'
    });
  });

  it('carries progress counts', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.clone', total: 100 });

    handle.start();
    handle.update({ completed: 40, message: 'Receiving objects' });

    expect(operations.get('op-1')).toMatchObject({
      completed: 40,
      total: 100,
      message: 'Receiving objects'
    });
  });

  it('ignores updates after a terminal state', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.fetch' });

    handle.succeed('done');
    handle.update({ message: 'still going' });
    handle.fail('too late');

    expect(operations.get('op-1')).toMatchObject({ state: 'succeeded', message: 'done' });
  });
});

describe('cancellation', () => {
  it('aborts the signal the runner is watching', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.fetch' });
    handle.start();

    expect(handle.signal.aborted).toBe(false);
    expect(operations.cancel('op-1')).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(handle.cancelled).toBe(true);
  });

  it('reports cancelled even when the body finishes normally', () => {
    // A killed git process usually exits without an error of its own.
    // Reporting that as success would tell the user a push landed.
    const operations = registry();
    const handle = operations.begin({ kind: 'git.push' });

    handle.start();
    operations.cancel('op-1');
    handle.succeed('finished');

    expect(operations.get('op-1')).toMatchObject({ state: 'cancelled' });
  });

  it('reports cancelled rather than failed when the body throws', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.push' });

    handle.start();
    operations.cancel('op-1');
    handle.fail('killed');

    expect(operations.get('op-1')).toMatchObject({ state: 'cancelled' });
  });

  it('refuses to cancel an operation that declared itself uncancellable', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'config.migrate', cancellable: false });

    expect(operations.cancel('op-1')).toBe(false);
    expect(handle.signal.aborted).toBe(false);
  });

  it('refuses to cancel an unknown or already finished operation', () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.fetch' });
    handle.succeed();

    expect(operations.cancel('op-1')).toBe(false);
    expect(operations.cancel('nonexistent')).toBe(false);
  });

  it('cancels everything in flight at once', () => {
    const operations = registry();
    const first = operations.begin({ kind: 'git.fetch' });
    const second = operations.begin({ kind: 'git.push' });

    operations.cancelAll();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });
});

describe('subscribers', () => {
  it('receives every state change', () => {
    const operations = registry();
    const seen: OperationProgress[] = [];
    operations.subscribe((operation) => seen.push(operation));

    const handle = operations.begin({ kind: 'git.fetch' });
    handle.start();
    handle.succeed();

    expect(seen.map((operation) => operation.state)).toEqual(['queued', 'running', 'succeeded']);
  });

  it('stops after the disposer runs', () => {
    const operations = registry();
    const seen: OperationProgress[] = [];
    const unsubscribe = operations.subscribe((operation) => seen.push(operation));

    operations.begin({ kind: 'a' });
    unsubscribe();
    operations.begin({ kind: 'b' });

    expect(seen).toHaveLength(1);
  });

  it('keeps notifying the others when one subscriber throws', () => {
    // A closed SSE response is exactly this case.
    const operations = registry();
    const seen: OperationProgress[] = [];

    operations.subscribe(() => {
      throw new Error('this subscriber is gone');
    });
    operations.subscribe((operation) => seen.push(operation));

    operations.begin({ kind: 'git.fetch' });

    expect(seen).toHaveLength(1);
  });

  it('hands out copies, so a subscriber cannot mutate the registry', () => {
    const operations = registry();
    operations.subscribe((operation) => {
      operation.state = 'failed';
    });

    operations.begin({ kind: 'git.fetch' });

    expect(operations.get('op-1')).toMatchObject({ state: 'queued' });
  });
});

describe('run', () => {
  it('tracks a successful body', async () => {
    const operations = registry();

    await expect(operations.run({ kind: 'git.fetch' }, async () => 'value')).resolves.toBe(
      'value'
    );
    expect(operations.get('op-1')).toMatchObject({ state: 'succeeded' });
  });

  it('records a rejection and re-throws it', async () => {
    const operations = registry();

    await expect(
      operations.run({ kind: 'git.fetch' }, () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom');
    expect(operations.get('op-1')).toMatchObject({ state: 'failed', message: 'boom' });
  });

  it('cancels a real process tree through the runner', async () => {
    const operations = registry();
    const runner = createExecutableRunner();

    const running = operations.run({ kind: 'dev.sleep' }, (handle) =>
      runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        signal: handle.signal
      })
    );

    // The handle is registered synchronously by `begin`, so the id exists by
    // the time this runs.
    expect(operations.cancel('op-1')).toBe(true);

    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(operations.get('op-1')).toMatchObject({ state: 'cancelled' });
  });
});

describe('retention', () => {
  it('drops finished operations once they age out', async () => {
    const operations = registry();
    const handle = operations.begin({ kind: 'git.fetch' });
    handle.succeed();

    expect(operations.list()).toHaveLength(1);

    // Reaching past the retention window without waiting a real minute.
    const entry = (operations as unknown as {
      entries: Map<string, { finishedAt: number | null }>;
    }).entries.get('op-1');
    if (entry) {
      entry.finishedAt = Date.now() - COMPLETED_RETENTION_MS - 1;
    }

    expect(operations.list()).toHaveLength(0);
  });

  it('caps how many finished operations are retained', () => {
    const operations = registry();

    for (let index = 0; index < MAX_COMPLETED_RETAINED + 10; index += 1) {
      operations.begin({ kind: 'git.fetch' }).succeed();
    }

    expect(operations.list()).toHaveLength(MAX_COMPLETED_RETAINED);
  });

  it('never drops an operation that is still running', () => {
    const operations = registry();
    operations.begin({ kind: 'git.push' }).start();

    for (let index = 0; index < MAX_COMPLETED_RETAINED + 10; index += 1) {
      operations.begin({ kind: 'git.fetch' }).succeed();
    }

    expect(operations.list().filter((operation) => operation.state === 'running')).toHaveLength(1);
  });
});
