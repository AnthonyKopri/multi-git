'use strict';

// Finding a command on Windows, where "gh" is not a file.
//
// `spawn('gh', args)` without a shell asks the OS to run a file called exactly
// `gh`. On Windows there is no such file: the tool is `gh.exe`, or `gh.cmd`, or
// `gh.bat`, and which one depends on how it was installed — the MSI and winget
// ship an .exe, while scoop and npm-installed CLIs ship a .cmd shim. libuv
// papers over the .exe case by trying PATHEXT, so a machine with the MSI never
// notices; a machine with a shim gets ENOENT, or, since the fix for
// CVE-2024-27980, an outright refusal to run a .cmd without a shell.
//
// Setting `shell: true` would fix the lookup and open a much worse door: every
// argument would then be parsed by cmd.exe, so a branch name or a file path
// containing `&` or `|` would stop being data. So the file is found here
// instead, and a batch shim is run through cmd.exe with each argument escaped
// for both cmd and the program behind it.
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';

/** PATHEXT, or the set Windows itself falls back to when it is unset. */
function extensions() {
  const raw = process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  return raw.split(';').map((entry) => entry.trim()).filter(Boolean);
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * The path as the filesystem spells it.
 *
 * PATHEXT is conventionally uppercase and the files are not, so probing
 * `gh` + `.CMD` finds `gh.cmd` on a case-insensitive volume and would
 * otherwise hand back a name no directory listing contains.
 */
function trueSpelling(candidate) {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

/**
 * The file a bare command name refers to, or null when it is not on PATH.
 *
 * A name that already has a path separator is taken as given: it is a path, not
 * something to look up.
 */
function findExecutable(command, { pathValue = process.env['PATH'] ?? '' } = {}) {
  if (command.includes('/') || command.includes('\\')) {
    return isFile(command) ? command : null;
  }

  const directories = pathValue.split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    const base = path.join(directory, command);

    // An exact hit wins, which is the whole story off Windows.
    if (isFile(base)) {
      return isWindows ? trueSpelling(base) : base;
    }
    if (!isWindows) {
      continue;
    }

    for (const extension of extensions()) {
      const candidate = base + extension;
      if (isFile(candidate)) {
        return trueSpelling(candidate);
      }
    }
  }

  return null;
}

/** cmd.exe's own metacharacters, which have to survive being passed through. */
const META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Escapes one argument for a command line that cmd.exe will read first and the
 * program will parse second.
 *
 * Two layers, in this order: backslash-escape any quotes so the program's own
 * parser rebuilds the original string, then caret-escape everything cmd treats
 * as syntax so cmd hands the whole thing over untouched. A batch shim adds a
 * third pass of its own, which is what `doubleEscape` accounts for.
 */
function escapeArgument(argument, doubleEscape) {
  let value = String(argument);

  value = value.replace(/(\\*)"/g, '$1$1\\"');
  value = value.replace(/(\\*)$/, '$1$1');
  value = `"${value}"`;
  value = value.replace(META_CHARACTERS, '^$&');

  if (doubleEscape) {
    value = value.replace(META_CHARACTERS, '^$&');
  }

  return value;
}

/**
 * What to hand `spawn` for a command, with any Windows shim unwrapped.
 *
 * Returns the file to run, the arguments to run it with, and the spawn options
 * that go with them. `shell` stays false in every case.
 */
function spawnSpec(command, args = []) {
  const resolved = findExecutable(command);

  // Not found: hand the original name back so the spawn fails with an ENOENT
  // naming the command the caller asked for, which is the useful error.
  if (resolved === null) {
    return { file: command, args: [...args], options: {} };
  }

  const isBatch = isWindows && /[.](cmd|bat)$/i.test(resolved);
  if (!isBatch) {
    return { file: resolved, args: [...args], options: {} };
  }

  const line = [resolved, ...args]
    .map((argument, index) => escapeArgument(argument, index > 0))
    .join(' ');

  return {
    file: process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe',
    // `/d` skips AutoRun scripts, `/s` keeps the outer quotes intact, `/c` runs
    // the line and exits.
    args: ['/d', '/s', '/c', `"${line}"`],
    // The line is already exactly what cmd should see; letting Node re-quote it
    // would undo the escaping above.
    options: { windowsVerbatimArguments: true }
  };
}

module.exports = { findExecutable, escapeArgument, spawnSpec };
