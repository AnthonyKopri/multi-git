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
  help: boolean;
}

interface ShipApi {
  parseArgs(argv: string[]): ShipOptions;
  answerToAction(answer: unknown): 'run' | 'skip' | 'quit' | 'unclear';
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

  it('refuses an unknown flag rather than ignoring it', () => {
    // A typo in a release command should stop the release, not run one that
    // silently means something else.
    expect(() => ship.parseArgs(['--publsh'])).toThrow('Unknown option');
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
