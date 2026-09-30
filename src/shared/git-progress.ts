// Reads the progress git writes to stderr during a clone, and turns it into
// something a bar can draw: how far along, and roughly how long is left.
//
// Git prints a status line for each phase of a clone, redrawing it in place with
// a carriage return:
//
//   remote: Counting objects: 100% (1234/1234), done.
//   remote: Compressing objects:  45% (200/440)
//   Receiving objects:  45% (555/1234), 1.20 MiB | 2.50 MiB/s
//   Resolving deltas:  12% (5/40)
//   Updating files:  45% (10/22)
//
// Each phase counts from 0 to 100 on its own, so a bar drawn straight from them
// would fill four times. `overallFraction` lays the phases end to end instead.
//
// Nothing here is exact and none of it claims to be. Git never says how large
// the pack is before sending it, so unless a size is supplied the size still to
// come is guessed from how much of the object count has arrived. The time left is
// that size over how fast the last few seconds have gone.
import type { TransferProgress } from './operation-types';

/** The phases of a clone that report progress, in the order they run. */
export type CloneStage = 'counting' | 'compressing' | 'receiving' | 'resolving' | 'checkout';

/** One progress line, as git wrote it. */
export interface GitProgressLine {
  stage: CloneStage;
  /** Git's own wording for the phase, such as "Receiving objects". */
  title: string;
  completed: number;
  total: number;
  /** Bytes received so far. Only lines that carry a throughput figure have it. */
  bytes?: number;
  bytesPerSecond?: number;
}

/**
 * What the tracker reports each time it has something worth showing.
 *
 * Shaped so it can be handed straight to an operation's `update`.
 */
export interface CloneProgressSnapshot {
  stage: CloneStage;
  /** Git's name for the phase, such as "Receiving objects". */
  message: string;
  completed: number;
  total: number;
  transfer: TransferProgress;
}

/**
 * How much of the bar each phase owns.
 *
 * Receiving is the one that depends on the network and dominates on a slow link,
 * so it gets most of it. Resolving and checkout are local and usually quick, but
 * on a large repository they are not nothing, so they keep a real share rather
 * than the bar sitting at 100% while work continues.
 */
const STAGE_SPAN: Readonly<Record<CloneStage, readonly [start: number, end: number]>> = {
  counting: [0, 0.03],
  compressing: [0.03, 0.1],
  receiving: [0.1, 0.7],
  resolving: [0.7, 0.9],
  checkout: [0.9, 1]
};

/** Git's titles, matched loosely: older versions word a few of them differently. */
const STAGE_TITLES: ReadonlyArray<readonly [RegExp, CloneStage]> = [
  [/^(counting|finding sources)\b/i, 'counting'],
  [/^compressing\b/i, 'compressing'],
  [/^receiving\b/i, 'receiving'],
  [/^(resolving|unpacking)\b/i, 'resolving'],
  [/^(updating|checking out) files\b/i, 'checkout']
];

/**
 * `Title:  45% (555/1234)` with an optional `, 1.20 MiB | 2.50 MiB/s` after it.
 *
 * The percentage is padded with spaces to three columns, and a `remote:` prefix
 * is added by git to whatever the server printed, hence the loose whitespace.
 */
const PROGRESS_LINE =
  /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+\d{1,3}%\s+\((\d+)\/(\d+)\)(?:,\s*([\d.]+)\s*(bytes?|[KMGT]iB)(?:\s*\|\s*([\d.]+)\s*(bytes?|[KMGT]iB)\/s)?)?/;

const UNIT_BYTES: Readonly<Record<string, number>> = {
  byte: 1,
  bytes: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4
};

function toBytes(value: string, unit: string): number | undefined {
  const amount = Number(value);
  const scale = UNIT_BYTES[unit];
  return Number.isFinite(amount) && scale !== undefined ? amount * scale : undefined;
}

// Some servers clear the line with an escape sequence after their text.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Reads one line of git's stderr. Null for anything that is not a progress
 * line for a phase this knows, so unfamiliar lines are ignored rather than
 * guessed at.
 */
export function parseGitProgress(rawLine: string): GitProgressLine | null {
  const match = PROGRESS_LINE.exec(rawLine.replace(ANSI_ESCAPE, '').trim());
  if (!match) {
    return null;
  }

  const title = (match[1] ?? '').trim();
  const stage = STAGE_TITLES.find(([pattern]) => pattern.test(title))?.[1];
  const completed = Number(match[2]);
  const total = Number(match[3]);

  if (stage === undefined || !Number.isFinite(completed) || !Number.isFinite(total)) {
    return null;
  }

  const line: GitProgressLine = { stage, title, completed, total };

  if (match[4] !== undefined && match[5] !== undefined) {
    const bytes = toBytes(match[4], match[5]);
    if (bytes !== undefined) {
      line.bytes = bytes;
    }
  }
  if (match[6] !== undefined && match[7] !== undefined) {
    const rate = toBytes(match[6], match[7]);
    if (rate !== undefined) {
      line.bytesPerSecond = rate;
    }
  }

  return line;
}

/**
 * stderr with the progress redraws taken out.
 *
 * Asking git for progress means every redraw of every line ends up in stderr,
 * thousands of them for a large repository. Whoever reads the result afterwards
 * wants what git had to say, not the animation.
 */
export function withoutGitProgress(stderr: string): string {
  return stderr
    .split(/[\r\n]+/)
    .filter((line) => line.trim() !== '' && parseGitProgress(line) === null)
    .join('\n');
}

/** Where a phase's own 0 to 1 lands on the whole bar. */
export function overallFraction(stage: CloneStage, completed: number, total: number): number {
  const [start, end] = STAGE_SPAN[stage];
  const within = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  // Exactly `end` when finished, so the last step of one phase and the first of
  // the next land on the same number instead of one rounding error apart.
  return within >= 1 ? end : start + (end - start) * within;
}

/**
 * How much history the pace is taken from.
 *
 * Long enough to smooth over the second-to-second jitter of a network, short
 * enough that a link which slows down or speeds up is reflected in the estimate
 * within a few seconds. An average over the whole phase would barely notice.
 */
export const PACE_WINDOW_MS = 10_000;

/**
 * How little of a phase has to have happened before its pace means anything.
 *
 * The first couple of seconds of a transfer are connection setup, and the first
 * few percent of a pack are whatever happened to sort first. An estimate drawn
 * from that swings wildly and is worse than none.
 */
export const MIN_ESTIMATE_ELAPSED_MS = 2000;
export const MIN_ESTIMATE_FRACTION = 0.02;

/**
 * How fast something has been going lately, measured over a sliding window.
 *
 * The window ends at the moment of asking rather than at the last sample, so a
 * transfer that has gone quiet reads as slowing down instead of holding the pace
 * it last had. Git only redraws a line when an object arrives, so silence is
 * exactly what a stalled connection looks like.
 */
class Pace {
  private samples: Array<{ at: number; value: number }> = [];

  add(at: number, value: number): void {
    this.samples.push({ at, value });
    this.prune(at);
  }

  /** Units per millisecond, or undefined until there is enough history to say. */
  rate(now: number): number | undefined {
    this.prune(now);

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) {
      return undefined;
    }

    const span = now - first.at;
    return span < MIN_ESTIMATE_ELAPSED_MS ? undefined : (last.value - first.value) / span;
  }

  private prune(now: number): void {
    // The newest sample always stays: with none left there would be nothing to
    // say that a long stall has happened, only that nothing has been seen.
    while (this.samples.length > 1 && (this.samples[0] as { at: number }).at < now - PACE_WINDOW_MS) {
      this.samples.shift();
    }
  }
}

/** Snapshots closer together than this are dropped unless the bar visibly moved. */
const MIN_PUBLISH_INTERVAL_MS = 250;
const MIN_PUBLISH_FRACTION_STEP = 0.005;

export interface CloneProgressTrackerOptions {
  /** A clock the caller controls. Only tests have a reason to pass one. */
  now?: () => number;
  /**
   * How many bytes the download is expected to be, when something knows.
   *
   * Git never says, but GitHub does: `gh` lists each repository's size, which
   * for a clone lands within a percent or two of what is received. With it the
   * time left is the bytes still to come over the current speed, instead of a
   * size guessed from how many objects have arrived.
   */
  expectedBytes?: number;
}

/**
 * Feeds on raw stderr chunks and reports progress worth showing.
 *
 * Chunks arrive wherever the pipe happens to cut them, so a line is only read
 * once its terminator has arrived. Both `\r` and `\n` end one: git redraws a
 * phase with the first and finishes it with the second.
 *
 * The time left comes from how fast the current phase has been going over the
 * last few seconds, so it moves as the speed does. Where git reports bytes it is
 * the bytes still to come over the byte rate; where it does not, or for the
 * phases that are not a download, it is the items still to come over the item
 * rate. `refresh` re-reads it without waiting for git to write anything.
 */
export class CloneProgressTracker {
  private readonly now: () => number;
  private readonly expectedBytes: number | undefined;
  private pending = '';
  private stage: CloneStage | null = null;
  private latest: GitProgressLine | null = null;
  private bytesPace = new Pace();
  private itemsPace = new Pace();
  private highest = 0;
  private lastPublishedAt = -Infinity;
  private lastPublishedFraction = -1;

  constructor(options: CloneProgressTrackerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.expectedBytes =
      options.expectedBytes !== undefined && options.expectedBytes > 0
        ? options.expectedBytes
        : undefined;
  }

  /**
   * Returns the latest snapshot the chunk produced, or null when it held no
   * progress line or nothing had moved enough to be worth publishing.
   */
  push(chunk: string): CloneProgressSnapshot | null {
    const segments = (this.pending + chunk).split(/[\r\n]/);
    // The last piece has no terminator yet. Carried over so a line cut in the
    // middle is read whole rather than as two fragments neither of which parses.
    this.pending = segments.pop() ?? '';

    let latest: CloneProgressSnapshot | null = null;
    for (const segment of segments) {
      const line = parseGitProgress(segment);
      if (line) {
        latest = this.observe(line);
      }
    }

    return latest && this.worthPublishing(latest) ? latest : null;
  }

  /**
   * The current picture, worked out again as of now.
   *
   * For a caller with a timer. Git writes nothing while a connection is stalled,
   * so without this the estimate would sit on the last thing it said instead of
   * lengthening. Null before anything has been read, and once a phase is done,
   * since there is then nothing left to estimate.
   */
  refresh(): CloneProgressSnapshot | null {
    if (!this.latest || this.latest.completed >= this.latest.total) {
      return null;
    }
    return this.describe(this.latest, this.now());
  }

  private observe(line: GitProgressLine): CloneProgressSnapshot {
    const now = this.now();

    if (line.stage !== this.stage) {
      // Each phase has its own speed, and a download's is no guide to a checkout's.
      this.stage = line.stage;
      this.bytesPace = new Pace();
      this.itemsPace = new Pace();
    }

    this.latest = line;
    this.itemsPace.add(now, line.completed);
    if (line.bytes !== undefined) {
      this.bytesPace.add(now, line.bytes);
    }

    this.highest = Math.max(
      this.highest,
      overallFraction(line.stage, line.completed, line.total)
    );

    return this.describe(line, now);
  }

  private describe(line: GitProgressLine, now: number): CloneProgressSnapshot {
    const transfer: TransferProgress = { fraction: this.highest };
    const bytesPerMs = this.bytesPace.rate(now);

    if (line.bytes !== undefined) {
      transfer.bytes = line.bytes;
    }
    // Ours where we have one, so the speed shown is the one the time is worked
    // out from; git's own figure otherwise.
    if (bytesPerMs !== undefined && line.bytes !== undefined) {
      transfer.bytesPerSecond = bytesPerMs * 1000;
    } else if (line.bytesPerSecond !== undefined) {
      transfer.bytesPerSecond = line.bytesPerSecond;
    }
    // Only while it still holds: past it the size was an underestimate, and
    // "40 MiB of ~37 MiB" would only say so out loud.
    if (
      this.expectedBytes !== undefined &&
      line.stage === 'receiving' &&
      (line.bytes === undefined || line.bytes < this.expectedBytes)
    ) {
      transfer.expectedBytes = this.expectedBytes;
    }

    const remainingMs = this.remainingMs(line, now, bytesPerMs);
    if (remainingMs !== undefined) {
      transfer.remainingMs = remainingMs;
    }

    return {
      stage: line.stage,
      message: line.title,
      completed: line.completed,
      total: line.total,
      transfer
    };
  }

  private remainingMs(
    line: GitProgressLine,
    now: number,
    bytesPerMs: number | undefined
  ): number | undefined {
    if (line.total <= 0 || line.completed >= line.total) {
      return undefined;
    }

    const share = line.completed / line.total;

    // Bytes to come over bytes per second, which is what a download is.
    if (line.bytes !== undefined && bytesPerMs !== undefined) {
      let remainingBytes: number | undefined;

      if (this.expectedBytes !== undefined && line.bytes < this.expectedBytes) {
        remainingBytes = this.expectedBytes - line.bytes;
      } else if (share >= MIN_ESTIMATE_FRACTION) {
        // No size to go on, so the size still to come is guessed from the share
        // of objects still to come. Objects are not all the same size, which is
        // why a known size is so much better.
        remainingBytes = (line.bytes * (1 - share)) / share;
      }

      if (remainingBytes !== undefined) {
        // At a standstill there is no honest number, and a huge one is not one.
        return bytesPerMs > 0 ? Math.round(remainingBytes / bytesPerMs) : undefined;
      }
    }

    // Otherwise items to come over items per second, for the phases that count
    // things rather than bytes, and for a download before git has reported a size.
    const itemsPerMs = this.itemsPace.rate(now);
    if (itemsPerMs === undefined || itemsPerMs <= 0 || share < MIN_ESTIMATE_FRACTION) {
      return undefined;
    }
    return Math.round((line.total - line.completed) / itemsPerMs);
  }

  private worthPublishing(snapshot: CloneProgressSnapshot): boolean {
    const now = this.now();
    const finishedPhase = snapshot.completed >= snapshot.total;
    const moved = snapshot.transfer.fraction - this.lastPublishedFraction >= MIN_PUBLISH_FRACTION_STEP;
    const due = now - this.lastPublishedAt >= MIN_PUBLISH_INTERVAL_MS;

    // The end of a phase is always sent, so a phase never sits on 99%.
    if (!finishedPhase && !moved && !due) {
      return false;
    }

    this.lastPublishedAt = now;
    this.lastPublishedFraction = snapshot.transfer.fraction;
    return true;
  }
}
