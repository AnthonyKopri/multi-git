// What the committed .npmrc has to hold, and what it must never hold.
//
// The file is tracked so that every clone and every CI job installs with
// dependency install scripts turned off. It used to be gitignored, as a place
// registry tokens can end up; it is still never the place for one.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { fromAppRoot } from '../src/server/app-root';

/** The file's settings as key/value pairs, comments and blank lines skipped. */
function settings(): Map<string, string> {
  const entries = fs
    .readFileSync(fromAppRoot('.npmrc'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
    });
  return new Map(entries);
}

describe('the project .npmrc', () => {
  it('keeps dependency install scripts from running', () => {
    expect(settings().get('ignore-scripts')).toBe('true');
  });

  it('holds no credentials', () => {
    // npm scopes credentials to a registry (`//registry.npmjs.org/:_authToken`),
    // so the check is on how the key ends, not how it starts.
    const credentials = [...settings().keys()].filter((key) =>
      /(^|:)(_auth|_authToken|_password|username|certfile|keyfile)$/.test(key)
    );
    expect(credentials, 'credentials belong in the user-level ~/.npmrc').toEqual([]);
  });
});
