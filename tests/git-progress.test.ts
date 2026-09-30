import { describe, expect, it } from 'vitest';

import {
  CloneProgressTracker,
  PACE_WINDOW_MS,
  overallFraction,
  parseGitProgress,
  withoutGitProgress
} from '../src/shared/git-progress';
import type { CloneProgressTrackerOptions } from '../src/shared/git-progress';

const MIB = 1024 ** 2;

describe('parseGitProgress', () => {
  it('reads a receiving line with its size and speed', () => {
    expect(parseGitProgress('Receiving objects:  45% (555/1234), 1.20 MiB | 2.50 MiB/s')).toEqual({
      stage: 'receiving',
      title: 'Receiving objects',
      completed: 555,
      total: 1234,
      bytes: 1.2 * 1024 ** 2,
      bytesPerSecond: 2.5 * 1024 ** 2
    });
  });

  it('reads the closing line, which has ", done." after the figures', () => {
    expect(
      parseGitProgress('Receiving objects: 100% (24/24), 161.99 KiB | 1.47 MiB/s, done.')
    ).toMatchObject({ stage: 'receiving', completed: 24, total: 24 });
  });

  it('reads sizes given in bytes', () => {
    expect(parseGitProgress('Receiving objects: 4% (1/24), 512 bytes | 512 bytes/s')).toMatchObject({
      bytes: 512,
      bytesPerSecond: 512
    });
  });

  it('reads the phases the server prints, with git\'s remote prefix and padding', () => {
    expect(parseGitProgress('remote: Counting objects:   4% (1/24)          ')).toMatchObject({
      stage: 'counting',
      completed: 1,
      total: 24
    });
    expect(parseGitProgress('remote: Compressing objects:  50% (2/4)')).toMatchObject({
      stage: 'compressing'
    });
  });

  it('reads deltas and the checkout, under both names git has used for it', () => {
    expect(parseGitProgress('Resolving deltas:  16% (1/6)')).toMatchObject({ stage: 'resolving' });
    expect(parseGitProgress('Updating files: 100% (22/22), done.')).toMatchObject({ stage: 'checkout' });
    expect(parseGitProgress('Checking out files: 100% (22/22), done.')).toMatchObject({
      stage: 'checkout'
    });
  });

  it('ignores an escape sequence a server clears the line with', () => {
    expect(parseGitProgress('remote: Counting objects: 100% (5/5), done.\u001b[K')).toMatchObject({
      stage: 'counting',
      completed: 5
    });
  });

  it('ignores lines that are not progress, or are for a phase it does not know', () => {
    expect(parseGitProgress("Cloning into 'repo'...")).toBeNull();
    expect(parseGitProgress('remote: Enumerating objects: 24, done.')).toBeNull();
    expect(parseGitProgress('remote: Total 24 (delta 6), reused 0 (delta 0), pack-reused 0')).toBeNull();
    expect(parseGitProgress('Filtering content: 100% (3/3), 1.5 MiB | 2 MiB/s, done.')).toBeNull();
    expect(parseGitProgress('')).toBeNull();
  });
});

describe('overallFraction', () => {
  it('lays the phases end to end so the bar only moves forward', () => {
    const steps = [
      overallFraction('counting', 0, 10),
      overallFraction('counting', 10, 10),
      overallFraction('compressing', 10, 10),
      overallFraction('receiving', 0, 10),
      overallFraction('receiving', 5, 10),
      overallFraction('receiving', 10, 10),
      overallFraction('resolving', 10, 10),
      overallFraction('checkout', 5, 10),
      overallFraction('checkout', 10, 10)
    ];

    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(1);
  });

  it('gives the download most of the bar', () => {
    const download = overallFraction('receiving', 10, 10) - overallFraction('receiving', 0, 10);
    expect(download).toBeGreaterThan(0.5);
  });

  it('holds a phase that reports no total at its start rather than dividing by zero', () => {
    expect(overallFraction('receiving', 0, 0)).toBe(overallFraction('receiving', 0, 10));
  });
});

/** A tracker on a clock the test moves, and a way to feed it lines at chosen moments. */
function harness(options: CloneProgressTrackerOptions = {}) {
  const clock = { now: 0 };
  const tracker = new CloneProgressTracker({ ...options, now: () => clock.now });

  return {
    clock,
    tracker,
    /** Moves the clock to `seconds` and feeds a receiving line: `mib` received, `done` of `total` objects. */
    receive(seconds: number, mib: number, done: number, total = 1000) {
      clock.now = seconds * 1000;
      const percent = Math.floor((done / total) * 100);
      return tracker.push(
        `Receiving objects: ${percent}% (${done}/${total}), ${mib.toFixed(2)} MiB | 1.00 MiB/s\r`
      );
    }
  };
}

describe('CloneProgressTracker', () => {
  it('reads lines split across chunks', () => {
    const { tracker } = harness();

    expect(tracker.push('Receiving objects:  4')).toBeNull();
    expect(tracker.push('5% (555/1234), 1.2 MiB | 2.5 MiB/s\r')).toMatchObject({
      message: 'Receiving objects',
      completed: 555,
      total: 1234
    });
  });

  it('reports the latest line when a chunk carries several', () => {
    const { tracker } = harness();

    const snapshot = tracker.push(
      'Receiving objects:  10% (10/100)\rReceiving objects:  20% (20/100)\rReceiving objects:  30% (30/100)\r'
    );

    expect(snapshot).toMatchObject({ completed: 30, total: 100 });
  });

  it('ignores output that is not progress', () => {
    const { tracker } = harness();

    expect(tracker.push("Cloning into 'repo'...\nremote: Enumerating objects: 24, done.\n")).toBeNull();
  });

  it('never lets the bar go backwards when a later phase starts from zero', () => {
    const { clock, tracker } = harness();

    const receiving = tracker.push('Receiving objects: 100% (10/10), done.\n');
    clock.now += 1000;
    const resolving = tracker.push('Resolving deltas:   0% (0/5)\r');

    expect(resolving?.transfer.fraction).toBeGreaterThanOrEqual(receiving?.transfer.fraction ?? 1);
  });

  describe('publishing', () => {
    it('holds back updates that arrive faster than they can be read, but not the end of a phase', () => {
      const { clock, tracker } = harness();

      expect(tracker.push('Receiving objects:  10% (100/1000)\r')).not.toBeNull();
      clock.now = 10;
      expect(tracker.push('Receiving objects:  10% (101/1000)\r')).toBeNull();
      clock.now = 20;
      expect(tracker.push('Receiving objects: 100% (1000/1000), done.\n')).not.toBeNull();
    });

    it('passes a step the bar visibly moved by, however soon it comes', () => {
      const { clock, tracker } = harness();

      tracker.push('Receiving objects:  10% (100/1000)\r');
      clock.now = 10;

      expect(tracker.push('Receiving objects:  20% (200/1000)\r')).not.toBeNull();
    });

    it('still learns the pace from lines it does not publish', () => {
      const { clock, tracker } = harness({ expectedBytes: 100 * MIB });

      tracker.push('Receiving objects:  1% (10/1000), 1.00 MiB | 1.00 MiB/s\r');
      // Ten lines inside a quarter of a second, none of them worth publishing.
      for (let index = 1; index <= 10; index += 1) {
        clock.now = index * 20;
        tracker.push(`Receiving objects:  1% (10/1000), ${1 + index * 0.001} MiB | 1.00 MiB/s\r`);
      }
      clock.now = 10_000;
      const snapshot = tracker.push('Receiving objects:  2% (20/1000), 11.00 MiB | 1.00 MiB/s\r');

      expect(snapshot?.transfer.remainingMs).toBeDefined();
    });
  });

  describe('the time left', () => {
    it('is the bytes still to come over the speed, when the size is known', () => {
      const { receive } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second < 10; second += 1) receive(second, 1 + second, 10 + second);
      const snapshot = receive(10, 11, 20);

      // 89 MiB to go at 1 MiB/s.
      expect(snapshot?.transfer.remainingMs).toBeCloseTo(89_000, -2);
      expect(snapshot?.transfer.bytesPerSecond).toBeCloseTo(MIB, -3);
      expect(snapshot?.transfer.expectedBytes).toBe(100 * MIB);
    });

    it('follows the speed as it changes, not the average since the start', () => {
      const { receive } = harness({ expectedBytes: 100 * MIB });

      // Ten seconds at 1 MiB/s, then ten at 4 MiB/s.
      receive(0, 1, 10);
      for (let second = 1; second <= 10; second += 1) receive(second, 1 + second, 10 + second);
      for (let second = 11; second <= 19; second += 1) receive(second, 11 + (second - 10) * 4, 10 + second);
      const snapshot = receive(20, 51, 30);

      // The last ten seconds ran at 4 MiB/s, so 49 MiB to go is about 12 s. An
      // average over the whole transfer would have said 19 s.
      expect(snapshot?.transfer.remainingMs).toBeCloseTo(12_250, -2);
      expect(snapshot?.transfer.bytesPerSecond).toBeCloseTo(4 * MIB, -3);
    });

    it('lengthens when the speed drops', () => {
      const { receive } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second <= 10; second += 1) receive(second, 1 + second * 4, 10 + second);
      const fast = receive(10, 41, 20);

      // Then a quarter of the speed for ten seconds.
      for (let second = 11; second <= 19; second += 1) receive(second, 41 + (second - 10), 10 + second);
      const slow = receive(20, 51, 30);

      expect(slow?.transfer.remainingMs).toBeGreaterThan((fast?.transfer.remainingMs ?? 0) * 2);
    });

    it('keeps lengthening while nothing arrives at all', () => {
      const { clock, receive, tracker } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second <= 10; second += 1) receive(second, 1 + second, 10 + second);
      const before = tracker.refresh();

      // Git writes nothing while the connection is stalled, so this is all there is.
      clock.now = 15_000;
      const stalling = tracker.refresh();

      expect(stalling?.transfer.remainingMs).toBeGreaterThan(before?.transfer.remainingMs ?? Infinity);
      expect(stalling?.transfer.bytesPerSecond).toBeLessThan(before?.transfer.bytesPerSecond ?? 0);
    });

    it('gives no time, rather than an enormous one, once the transfer has stood still', () => {
      const { clock, receive, tracker } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second <= 10; second += 1) receive(second, 1 + second, 10 + second);

      clock.now = 10_000 + PACE_WINDOW_MS + 5_000;
      const stalled = tracker.refresh();

      expect(stalled?.transfer.remainingMs).toBeUndefined();
      expect(stalled?.transfer.bytesPerSecond).toBe(0);
    });

    it('picks up again when a stalled transfer resumes', () => {
      const { receive } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      receive(5, 1, 10);
      receive(10, 1, 10);
      for (let second = 11; second <= 19; second += 1) receive(second, 1 + (second - 10) * 2, 10 + second);
      const resumed = receive(20, 21, 30);

      expect(resumed?.transfer.remainingMs).toBeDefined();
    });

    it('guesses the size from the share of objects when it is not known', () => {
      const { receive } = harness();

      receive(0, 1, 10);
      for (let second = 1; second < 10; second += 1) receive(second, 1 + second, 10 + second);
      // 11 MiB for a quarter of the objects: 33 MiB to come at 1 MiB/s.
      const snapshot = receive(10, 11, 250);

      expect(snapshot?.transfer.remainingMs).toBeCloseTo(33_000, -2);
      expect(snapshot?.transfer.expectedBytes).toBeUndefined();
    });

    it('does not trust a size that has already been passed, and stops showing it', () => {
      const { receive } = harness({ expectedBytes: 5 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second < 10; second += 1) receive(second, 1 + second, 10 + second);
      const snapshot = receive(10, 11, 250);

      // Back to guessing from the share of objects, as if no size had been given.
      expect(snapshot?.transfer.remainingMs).toBeCloseTo(33_000, -2);
      expect(snapshot?.transfer.expectedBytes).toBeUndefined();
    });

    it('offers nothing in the first moments', () => {
      const { receive } = harness({ expectedBytes: 100 * MIB });

      receive(0, 0.5, 5);
      const snapshot = receive(1.5, 2, 30);

      expect(snapshot?.transfer.remainingMs).toBeUndefined();
    });

    it('offers nothing from the object share alone until enough has arrived to guess from', () => {
      const { receive } = harness();

      receive(0, 1, 5);
      for (let second = 1; second < 10; second += 1) receive(second, 1 + second, 5 + second);
      // Two seconds' worth of history but under 2% of the objects.
      const snapshot = receive(10, 11, 15);

      expect(snapshot?.transfer.remainingMs).toBeUndefined();
    });

    it('counts items when a phase has no bytes, at the pace of the last few seconds', () => {
      const { clock, tracker } = harness();

      const lineAt = (seconds: number, done: number) => {
        clock.now = seconds * 1000;
        return tracker.push(`Resolving deltas: ${Math.floor(done / 10)}% (${done}/1000)\r`);
      };

      lineAt(0, 100);
      for (let second = 1; second < 10; second += 1) lineAt(second, 100 + second * 50);
      const snapshot = lineAt(10, 600);

      // 50 a second, 400 to go.
      expect(snapshot?.transfer.remainingMs).toBeCloseTo(8_000, -2);
      expect(snapshot?.transfer.bytes).toBeUndefined();
    });

    it('starts a phase\'s pace afresh', () => {
      const { clock, receive, tracker } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second <= 10; second += 1) receive(second, 1 + second, 10 + second);
      receive(11, 90, 1000);
      clock.now = 11_500;
      const snapshot = tracker.push('Resolving deltas:  50% (50/100)\r');

      // Half a second into a new phase is too early to say, however long the
      // download before it took.
      expect(snapshot?.transfer.remainingMs).toBeUndefined();
    });

    it('is not given once a phase is finished', () => {
      const { clock, tracker } = harness({ expectedBytes: 100 * MIB });

      clock.now = 1000;
      tracker.push('Receiving objects: 100% (1000/1000), 100.00 MiB | 1.00 MiB/s, done.\n');
      clock.now = 5000;

      expect(tracker.refresh()).toBeNull();
    });
  });

  describe('refresh', () => {
    it('has nothing to say before git has', () => {
      expect(harness().tracker.refresh()).toBeNull();
    });

    it('restates the latest figures with the estimate worked out as of now', () => {
      const { clock, receive, tracker } = harness({ expectedBytes: 100 * MIB });

      receive(0, 1, 10);
      for (let second = 1; second <= 10; second += 1) receive(second, 1 + second, 10 + second);
      clock.now = 10_500;

      expect(tracker.refresh()).toMatchObject({
        stage: 'receiving',
        message: 'Receiving objects',
        completed: 20,
        total: 1000
      });
    });
  });
});

describe('withoutGitProgress', () => {
  it('keeps what git said and drops the redraws', () => {
    const stderr = [
      "Cloning into 'repo'...",
      'remote: Enumerating objects: 24, done.',
      'remote: Counting objects:   4% (1/24)          \rremote: Counting objects:   8% (2/24)          \r',
      'Receiving objects: 100% (24/24), 161.99 KiB | 1.47 MiB/s, done.',
      'Resolving deltas: 100% (6/6), done.',
      'warning: You appear to have cloned an empty repository.'
    ].join('\n');

    expect(withoutGitProgress(stderr)).toBe(
      [
        "Cloning into 'repo'...",
        'remote: Enumerating objects: 24, done.',
        'warning: You appear to have cloned an empty repository.'
      ].join('\n')
    );
  });

  it('returns an empty string when there was nothing else', () => {
    expect(withoutGitProgress('Receiving objects: 100% (1/1), done.\n')).toBe('');
  });
});
