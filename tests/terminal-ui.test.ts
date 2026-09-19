// The terminal UI, rendered for real into a fake terminal.
//
// Keys go in the way a terminal sends them, frames come out, and the backend
// is the real API on a real repository. What is pinned is what the plan asked
// of it: Vim-style keys, a leader menu that shows its continuations, a palette
// that finds workflows by name or intent, and no key typed into an input ever
// reaching an action.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink';

import { createApp } from '../src/server/app';
import { Terminal, asciiOnly, paletteMatches } from '../src/server/terminal/app';
import { defaultPreferences } from '../src/server/terminal/preferences';
import { actionGroups, actions } from '../src/server/terminal/actions';
import type { BackendConnection } from '../src/server/runtime/connection';
import { cleanupRepos, createRepoWithHistory, git } from './helpers/temp-repo';

class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true;
  frames: string[] = [];
  write = (frame: string): boolean => {
    this.frames.push(frame);
    return true;
  };
  lastFrame = (): string => this.frames.at(-1) ?? '';
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => this.queue.shift() ?? null;
  type(text: string): void {
    this.queue.push(text);
    this.emit('readable');
  }
}

let server: Server;
let origin: string;
const mounted: { unmount(): void }[] = [];

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const instance of mounted.splice(0)) instance.unmount();
});

afterAll(() => {
  server.close();
  cleanupRepos();
});

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

async function start(repo: string) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const connection: BackendConnection = {
    origin,
    close: async () => {},
    call: async <T,>(method: string) => {
      if (method === 'preferences.read') return defaultPreferences() as T;
      throw new Error(`unexpected private call ${method}`);
    }
  };
  const instance = render(React.createElement(Terminal, { connection, initialRepo: repo }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    // CI sets CI=true, which Ink otherwise takes to mean "write the last frame only".
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false
  });
  mounted.push(instance);

  const screen = (): string => strip(stdout.lastFrame());
  const until = async (check: (frame: string) => boolean, what: string): Promise<string> => {
    const deadline = Date.now() + 10_000;
    while (!check(screen())) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Screen:\n${screen()}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return screen();
  };
  const press = async (...keys: string[]): Promise<void> => {
    for (const key of keys) {
      stdin.type(key);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  return { screen, until, press };
}

function repoWithChange(): string {
  const repo = createRepoWithHistory();
  fs.writeFileSync(path.join(repo, 'change.txt'), 'new\n');
  return repo;
}

const staged = (repo: string): string => git(repo, 'diff', '--cached', '--name-only').trim();

describe('the terminal UI', () => {
  it('shows the repository, branch, sync and account state, and the changes', async () => {
    const repo = repoWithChange();
    const ui = await start(repo);
    const frame = await ui.until((text) => text.includes('change.txt'), 'the changes list');

    expect(frame).toContain(path.basename(repo));
    expect(frame).toContain(git(repo, 'branch', '--show-current').trim());
    expect(frame).toContain('Auto-pull: Off');
    expect(frame).toContain('NORMAL');
  });

  it('stages with s and shows the leader menu on Space until Esc', async () => {
    const repo = repoWithChange();
    const ui = await start(repo);
    await ui.until((text) => text.includes('change.txt'), 'the changes list');

    await ui.press('s');
    await ui.until(() => staged(repo) === 'change.txt', 'the file to be staged');
    // Keys are held back while an action is running, so wait for it to finish.
    await ui.until((text) => text.includes('Staged selected changes.') && text.includes('NORMAL'), 'the stage to finish');

    await ui.press(' ');
    const menu = await ui.until((text) => text.includes('Actions · press a shown key'), 'the leader menu');
    expect(menu).toMatch(/P\s+Push \/ Publish branch/);
    expect(menu).toMatch(/a\s+Switch SSH \/ account/);
    await ui.press('\x1b');
    await ui.until((text) => !text.includes('Actions · press a shown key'), 'the leader menu to close');
  });

  it('stages only the displayed match after filtering the file list', async () => {
    const repo = repoWithChange();
    fs.writeFileSync(path.join(repo, 'another.txt'), 'unrelated\n');
    const ui = await start(repo);
    await ui.until((text) => text.includes('another.txt') && text.includes('NORMAL'), 'both changes');
    await ui.press('/');
    await ui.press('change.txt');
    await ui.press('\r');
    await ui.until((text) => text.includes('/change.txt') && !text.includes('another.txt'), 'filtered files');
    await ui.press('s');
    await ui.until(() => staged(repo) !== '', 'staging');
    expect(staged(repo)).toBe('change.txt');
  });

  it('never acts on keys typed into the palette', async () => {
    const repo = repoWithChange();
    const ui = await start(repo);
    await ui.until((text) => text.includes('change.txt'), 'the changes list');

    await ui.press(':');
    await ui.until((text) => text.includes('Find an action'), 'the palette');
    // Every one of these is a command in NORMAL mode: stage, move, select, leader.
    await ui.press('s', 'j', 'v', 'G', ' ', 'u');
    const frame = await ui.until((text) => text.includes(':sjvG u'), 'the typed text');
    expect(frame).toContain('INPUT');
    expect(staged(repo)).toBe('');

    await ui.press('\x1b');
    await ui.until((text) => text.includes('NORMAL'), 'normal mode again');
    expect(staged(repo)).toBe('');
  });

  it('shows the keys, including the leader bindings, on ?', async () => {
    const ui = await start(repoWithChange());
    await ui.until((text) => text.includes('change.txt'), 'the changes list');
    await ui.press('?');
    const help = await ui.until((text) => text.includes('Keyboard help'), 'help');
    expect(help).toContain('Space f  fetch');
  });
});

describe('the action catalogue', () => {
  it('lists every action under a group the sidebar shows, once', () => {
    const ids = actions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of actions) expect(actionGroups, action.id).toContain(action.group);
    for (const group of actionGroups) expect(actions.some((action) => action.group === group), group).toBe(true);
  });
});

describe('the palette', () => {
  it('finds the everyday workflows by their names and aliases', () => {
    for (const [typed, id] of [
      ['fetch', 'fetch'], ['pull', 'pull'], ['push', 'push'], ['ssh', 'accounts'], ['auto-pull', 'auto-pull'],
      ['worktree', 'worktrees'], ['recover', 'recovery'], ['settings', 'settings']
    ]) {
      expect(paletteMatches(`:${typed}`)[0]?.id, typed).toBe(id);
    }
  });

  it('understands plain language', () => {
    expect(paletteMatches('change account')[0]?.id).toBe('accounts');
    expect(paletteMatches('get latest')[0]?.id).toBe('pull');
  });
});

describe('ASCII output', () => {
  it('leaves only ASCII in the interface text', () => {
    const text = asciiOnly('Changes · s stage — ↑1 ↓2 › ok… “quoted”');
    expect(text).toBe('Changes | s stage - ^1 v2 > ok... "quoted"');
    expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
  });
});
