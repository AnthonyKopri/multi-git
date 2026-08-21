// The release driver's argument and answer handling.
//
// The steps themselves spawn the documented commands and are exercised by
// running them; what is worth pinning here is the two places a wrong reading
// would do something the user did not ask for — a misparsed flag, and a
// mistyped answer at a prompt.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ShipOptions {
  bump: string | null;
  tag: string | null;
  repo: string | null;
  yes: boolean;
  dryRun: boolean;
  publish: boolean;
  changelog: boolean;
  help: boolean;
}

interface AskerLike {
  rl: { close: () => void } | null;
  close(): void;
}

interface ShipApi {
  parseArgs(argv: string[]): ShipOptions;
  answerToAction(answer: unknown): 'run' | 'skip' | 'quit' | 'unclear';
  Asker: new (options: { yes: boolean }) => AskerLike;
}

const require = createRequire(import.meta.url);
const ship = require('../scripts/ship.js') as ShipApi;

describe('parseArgs', () => {
  it('asks about everything when told nothing', () => {
    expect(ship.parseArgs([])).toEqual({
      bump: null,
      tag: null,
      repo: null,
      yes: false,
      dryRun: false,
      // Publishing is what makes a release public, so it never happens
      // because a flag was left off.
      publish: false,
      changelog: true,
      help: false
    });
  });

  it('reads the flags in either form', () => {
    expect(ship.parseArgs(['--bump=minor', '-R', 'owner/repo', '--dry-run'])).toMatchObject({
      bump: 'minor',
      repo: 'owner/repo',
      dryRun: true
    });

    expect(ship.parseArgs(['--bump', 'patch', '--tag', 'Release_v9.9.9', '-y'])).toMatchObject({
      bump: 'patch',
      tag: 'Release_v9.9.9',
      yes: true
    });
  });

  it('accepts the upload step’s own flag, so it means the same thing here', () => {
    // Reaching for `--no-changelog` on the command that wraps the upload is
    // the obvious thing to do, and it used to stop the release with
    // "Unknown option".
    expect(ship.parseArgs(['--no-changelog']).changelog).toBe(false);
    expect(ship.parseArgs([]).changelog).toBe(true);
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    // A typo in a release command should stop the release, not run one that
    // silently means something else.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('Unknown option');
    // And says where the list is, rather than leaving it to be guessed.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('--help');
  });

  it('refuses a flag whose value was swallowed by the next flag', () => {
    expect(() => ship.parseArgs(['--bump', '--yes'])).toThrow('--bump requires a value');
  });
});

describe('answerToAction', () => {
  it('treats a bare Enter as yes, because the prompt says [Y]', () => {
    expect(ship.answerToAction('')).toBe('run');
    expect(ship.answerToAction('y')).toBe('run');
    expect(ship.answerToAction('YES')).toBe('run');
  });

  it('reads a skip and a refusal the same way', () => {
    // Both mean "not this step", and neither means "stop everything".
    expect(ship.answerToAction('s')).toBe('skip');
    expect(ship.answerToAction('n')).toBe('skip');
    expect(ship.answerToAction('no')).toBe('skip');
  });

  it('reads a quit', () => {
    expect(ship.answerToAction('q')).toBe('quit');
    expect(ship.answerToAction('abort')).toBe('quit');
  });

  it('calls anything else unclear rather than guessing', () => {
    // "yeah" is not yes here. Guessing at a release step is how something
    // gets published that nobody meant to publish.
    expect(ship.answerToAction('yeah')).toBe('unclear');
    expect(ship.answerToAction('maybe')).toBe('unclear');
    expect(ship.answerToAction(undefined)).toBe('unclear');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(ship.answerToAction('  Q  ')).toBe('quit');
    expect(ship.answerToAction(' Skip ')).toBe('skip');
  });
});

describe('the prompt across a step that owns the terminal', () => {
  it('forgets a closed interface, so a later step can ask again', () => {
    // Step 1 closes this so `release.js` can own the terminal for its own
    // questions. Leaving the closed interface in place made every step after
    // it throw "readline was closed" — after the build had already succeeded,
    // which is the worst possible moment to lose the ability to ask.
    const asker = new ship.Asker({ yes: false });
    let closed = 0;
    asker.rl = { close: () => { closed += 1; } };

    asker.close();

    expect(closed).toBe(1);
    expect(asker.rl).toBeNull();
  });

  it('can be closed twice without complaining', () => {
    // The steps close it on the way out of several branches, and main() closes
    // it again in its finally.
    const asker = new ship.Asker({ yes: false });
    let closed = 0;
    asker.rl = { close: () => { closed += 1; } };

    asker.close();
    asker.close();

    expect(closed).toBe(1);
  });
});
