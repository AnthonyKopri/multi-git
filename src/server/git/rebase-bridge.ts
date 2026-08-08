// The two editors `git rebase -i` insists on opening.
//
// Git hands the todo list to GIT_SEQUENCE_EDITOR and each commit message to
// GIT_EDITOR, and waits for the program to exit. Both have to be answered
// without a human, and neither may be a shell script assembled from commit
// subjects or file paths — a subject is repository data, and repository data
// is not trusted input.
//
// So the bridge is a fixed script with no interpolation at all. It is told
// which editor it is standing in for by a literal argument, and where to find
// the replacement contents by an environment variable:
//
//   argv[2] = "sequence"  overwrite the todo with MULTI_GIT_TODO_FILE
//   argv[2] = "accept"    leave the file exactly as git prepared it
//   argv[3]               the file git wants edited, appended by git itself
//
// The mode has to be an argument rather than a shared environment variable,
// because git uses both editors during one rebase: a squash opens the message
// editor while the sequence editor's configuration is still in the
// environment, and a bridge that could not tell them apart wrote the todo list
// over the commit message.
//
// The only values spliced into the command string are the path of the Node
// binary already running this process and the path of the script this module
// wrote itself, both of which this application chose.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The bridge, verbatim.
 *
 * Written to disk rather than shipped in `out/` because a packaged build lives
 * inside an asar, which a plain `node` cannot read. A temp file is readable by
 * whichever interpreter ends up running it.
 */
const BRIDGE_SOURCE = `#!/usr/bin/env node
// Written by Multi-Git. Answers git's editor prompts without a human.
const fs = require('node:fs');

const mode = process.argv[2];
const target = process.argv[3];

if (!target) {
  process.exit(1);
}

// "accept" means the file git prepared is already what we want, which is the
// answer for every commit message: git combined them correctly.
if (mode !== 'sequence') {
  process.exit(0);
}

const source = process.env.MULTI_GIT_TODO_FILE;
if (source) {
  fs.writeFileSync(target, fs.readFileSync(source));
}

process.exit(0);
`;

export interface EditorBridge {
  /** Directory holding the script and the todo file. Remove when finished. */
  directory: string;
  scriptPath: string;
  todoPath: string;
}

/**
 * Creates a private directory holding the bridge script.
 *
 * `mkdtemp` gives a name nothing else can predict, and the mode keeps it to
 * this user — the todo file names commits and subjects from a repository the
 * user may not want world-readable on a shared machine.
 */
export function createEditorBridge(): EditorBridge {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-rebase-'));
  fs.chmodSync(directory, 0o700);

  const scriptPath = path.join(directory, 'editor-bridge.cjs');
  fs.writeFileSync(scriptPath, BRIDGE_SOURCE, { mode: 0o700 });

  return { directory, scriptPath, todoPath: path.join(directory, 'todo') };
}

/** Best effort: a leftover temp directory is untidy, not dangerous. */
export function removeEditorBridge(bridge: { directory: string } | null): void {
  if (!bridge) {
    return;
  }

  try {
    fs.rmSync(bridge.directory, { recursive: true, force: true });
  } catch (error) {
    console.warn('Could not remove the rebase bridge directory:', (error as Error).message);
  }
}

/**
 * Quotes one path for the command string git will hand to a shell.
 *
 * Both values are paths this application chose, so this is about spaces in
 * `C:\Program Files\...`, not about untrusted input. Double quotes work for
 * cmd.exe and for POSIX shells alike, and neither path can contain one.
 */
function quoteForShell(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

/** The interpreter to run the bridge with. */
function interpreter(): { command: string; env: NodeJS.ProcessEnv } {
  // Under Electron, argv[0] is the Electron binary; this variable is the
  // documented way to make it behave as a plain Node.
  return process.versions.electron
    ? { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { command: process.execPath, env: {} };
}

function invocation(bridge: EditorBridge, mode: 'sequence' | 'accept'): string {
  const { command } = interpreter();
  // Git appends the file to edit, so the mode has to come first.
  return `${quoteForShell(command)} ${quoteForShell(bridge.scriptPath)} ${mode}`;
}

export interface BridgeEnvOptions {
  /** Writes this todo over the one git prepared. */
  todoPath?: string;
}

/** The environment `git rebase -i` should run with. */
export function bridgeEnv(bridge: EditorBridge, options: BridgeEnvOptions = {}): NodeJS.ProcessEnv {
  return {
    ...interpreter().env,
    GIT_SEQUENCE_EDITOR: invocation(bridge, options.todoPath === undefined ? 'accept' : 'sequence'),
    // Squash and fixup open the message editor during the same rebase. The
    // message git prepared by combining the originals is the right answer.
    GIT_EDITOR: invocation(bridge, 'accept'),
    ...(options.todoPath === undefined ? {} : { MULTI_GIT_TODO_FILE: options.todoPath }),
    // Nothing here may fall back to asking a terminal, which would hang.
    GIT_TERMINAL_PROMPT: '0'
  };
}

/**
 * The environment for a git command that must not open an editor at all,
 * such as `rebase --continue` after a conflict has been resolved.
 */
export function acceptEditorEnv(bridge: EditorBridge): NodeJS.ProcessEnv {
  return {
    ...interpreter().env,
    GIT_EDITOR: invocation(bridge, 'accept'),
    GIT_SEQUENCE_EDITOR: invocation(bridge, 'accept'),
    GIT_TERMINAL_PROMPT: '0'
  };
}
