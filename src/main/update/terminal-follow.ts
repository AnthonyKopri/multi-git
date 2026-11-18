// After the app starts, brings an enabled terminal edition up to the copy this
// build carries. The decision is in server/terminal/follow.ts; the copy runs
// in a utility process (terminal-follow-child.ts) so no window waits for it.
import path from 'node:path';

import { BrowserWindow, utilityProcess } from 'electron';

import { bundledPayload, terminalStatus } from '../../server/terminal/install';
import { followDecision } from '../../server/terminal/follow';
import type { FollowResult } from '../../shared/terminal-types';
import type { BackendConnection } from '../../server/runtime/connection';
import type { AppConfig } from '../../shared/config-types';
import { IPC_CHANNELS } from '../../shared/desktop-api';

/** After the first windows have drawn, and clear of the first update check. */
const DELAY_MS = 6_000;
/** A copy that has not finished by then is not going to. */
const TIMEOUT_MS = 3 * 60_000;

type ChildReply = { ok: true; version: string | null } | { ok: false; message: string };

function copyInBackground(source: string): Promise<ChildReply> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(path.join(__dirname, 'terminal-follow.js'), [source], {
      serviceName: 'Multi-Git terminal edition update',
      stdio: 'ignore'
    });
    let settled = false;
    const settle = (reply: ChildReply): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(reply);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      settle({ ok: false, message: 'Copying the terminal edition took too long and was stopped.' });
    }, TIMEOUT_MS);
    timer.unref();

    child.once('message', (message: ChildReply) => {
      settle(message);
      // Its work is done once it has replied; it is not left running.
      child.kill();
    });
    child.once('exit', (code) => settle({ ok: false, message: `The update stopped early (exit code ${code}).` }));
  });
}

function announce(targets: () => BrowserWindow[], result: FollowResult): void {
  for (const window of targets()) {
    window.webContents.send(IPC_CHANNELS.terminalFollowed, result);
  }
}

/** Schedules the check once. Returns a function that cancels it, for quit. */
export function startTerminalFollow(targets: () => BrowserWindow[], backend: BackendConnection): () => void {
  const timer = setTimeout(() => {
    void (async () => {
      const source = bundledPayload();
      if (!source) {
        return;
      }
      const settings = (await backend.call<AppConfig>('config.read')).settings;
      const decision = followDecision(terminalStatus(), settings?.terminalFollowsApp !== false);
      if (!decision.follow) {
        return;
      }

      const reply = await copyInBackground(source);
      announce(
        targets,
        reply.ok
          ? { outcome: 'updated', from: decision.from, to: reply.version ?? decision.to }
          : { outcome: 'failed', from: decision.from, to: decision.to, message: reply.message }
      );
    })().catch((error: unknown) => {
      // Never a reason to disturb startup; Settings still shows the state.
      console.error('Terminal edition update skipped:', error);
    });
  }, DELAY_MS);
  timer.unref();
  return () => clearTimeout(timer);
}
