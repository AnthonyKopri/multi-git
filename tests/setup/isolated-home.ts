// Gives every test file a home directory of its own.
//
// Three of the things this application persists are resolved from `os.homedir()`
// at module load: the configuration, the passphrase vault, and `~/.ssh`. Under
// Vitest those resolved to the *developer's* real home, one set of files shared
// by every worker running in parallel.
//
// That made a whole class of test flaky rather than wrong. `writeConfig` writes
// the document whole, so two workers doing their own read-modify-write lose one
// of the two updates; a test that pins a branch and then reads it back fails
// only when another file happens to write config in between. It failed on CI,
// on one job of seven, and passed on the next commit with the same code — the
// signature of a race, and one that took a real investigation to attribute
// because the failing test named neither of the features involved.
//
// Setting the environment here, at module scope, is what makes this work:
// setup files are evaluated before the test file and therefore before anything
// it imports, and `CONFIG_FILE` and `SECRETS_FILE` are `path.join(os.homedir(),
// …)` evaluated once at import. Doing this in a `beforeAll` would be too late.
//
// It also stops the suite writing to the developer's own `~/.ssh` and
// configuration, which it previously did on every run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-home-'));

// `os.homedir()` reads USERPROFILE on Windows and HOME elsewhere, and consults
// them on every call rather than caching, so both are set and neither platform
// needs a special case here.
process.env['HOME'] = home;
process.env['USERPROFILE'] = home;

// Present but empty, because "the directory is not there" and "it holds no
// keys" are different states and only the second is the one under test.
fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });

afterAll(() => {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    // A leftover directory in the system temp folder is not worth failing a
    // green run over; the operating system clears it eventually.
  }
});
