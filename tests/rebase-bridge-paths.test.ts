import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bridgeEnv,
  createEditorBridge,
  removeEditorBridge
} from '../src/server/git/rebase-bridge';

const scratch: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of scratch.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.runIf(process.platform !== 'win32')('the POSIX rebase editor command', () => {
  it('keeps shell metacharacters in the bridge path literal', () => {
    const parent = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-rebase-parent-')),
      '$MULTI_GIT_REBASE_TRAP'
    );
    fs.mkdirSync(parent);
    scratch.push(path.dirname(parent));

    // createEditorBridge asks os.tmpdir() at call time. If its invocation uses
    // double quotes, the shell expands this literal component and looks for a
    // different script. A POSIX single-quoted argv word keeps it as a path.
    vi.stubEnv('TMPDIR', parent);
    vi.stubEnv('MULTI_GIT_REBASE_TRAP', 'expanded-by-the-shell');

    const bridge = createEditorBridge();
    try {
      const command = bridgeEnv(bridge).GIT_EDITOR as string;
      const result = spawnSync('/bin/sh', ['-c', `${command} ignored-target`], {
        env: { ...process.env, ...bridgeEnv(bridge) },
        encoding: 'utf8'
      });

      expect(result.status, result.stderr).toBe(0);
    } finally {
      removeEditorBridge(bridge);
    }
  });
});
