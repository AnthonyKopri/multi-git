// What a profile is still entitled to claim after it has been edited.
//
// Issue #50. `verifiedAccount` is learned rather than configured: a
// verification asks the host who a key authenticates as, and the answer is kept
// so the SSH Key dropdown can warn about a wrong account instantly and offline.
// That is sound while the profile means what it meant -- and editing a profile
// keeps its id while allowing the key path to change, which is precisely the
// case the wrong-account push guard exists to catch.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/server/app';
import { readConfig, writeConfig } from '../src/server/config/store';

const app: Express = createApp();

function api() {
  return {
    post: (url: string) => request(app).post(url).set('Host', '127.0.0.1'),
    delete: (url: string) => request(app).delete(url).set('Host', '127.0.0.1')
  };
}

let workspace: string;

/** A file at a path, since the route insists the key actually exists. */
function makeKey(name: string): string {
  const keyPath = path.join(workspace, name);
  fs.writeFileSync(keyPath, 'not a real key');
  return keyPath;
}

/** The stored profile, as it is on disk rather than as the response shaped it. */
function stored(id: string) {
  return readConfig().sshProfiles.find((profile) => profile.id === id);
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-profiles-'));

  const config = readConfig();
  config.sshProfiles = [];
  writeConfig(config);
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('saving an SSH profile', () => {
  it('keeps the verified account while the profile points at the same key', async () => {
    const keyPath = makeKey('id_ed25519');

    await api()
      .post('/api/config/ssh')
      .send({ id: 'p1', label: 'Work', privateKeyPath: keyPath, userEmail: 'me@example.com' })
      .expect(200);

    // As a verification would have recorded it.
    const config = readConfig();
    const entry = config.sshProfiles.find((profile) => profile.id === 'p1');
    if (entry) {
      entry.verifiedAccount = 'akopri-familiara';
    }
    writeConfig(config);

    // Renaming it, with the key untouched.
    await api()
      .post('/api/config/ssh')
      .send({ id: 'p1', label: 'Work (main)', privateKeyPath: keyPath, userEmail: 'me@example.com' })
      .expect(200);

    expect(stored('p1')?.label).toBe('Work (main)');
    // A key's account does not change, so neither should this.
    expect(stored('p1')?.verifiedAccount).toBe('akopri-familiara');
  });

  it('forgets the verified account when the profile is pointed at another key', async () => {
    // The defect. The id survives an edit, so anything keyed on the id alone
    // goes on describing a profile that no longer exists -- and what it
    // describes is which account a push will appear to come from.
    const original = makeKey('id_original');
    const replacement = makeKey('id_replacement');

    await api()
      .post('/api/config/ssh')
      .send({ id: 'p1', label: 'Work', privateKeyPath: original })
      .expect(200);

    const config = readConfig();
    const entry = config.sshProfiles.find((profile) => profile.id === 'p1');
    if (entry) {
      entry.verifiedAccount = 'akopri-familiara';
    }
    writeConfig(config);

    await api()
      .post('/api/config/ssh')
      .send({ id: 'p1', label: 'Work', privateKeyPath: replacement })
      .expect(200);

    expect(stored('p1')?.privateKeyPath).toBe(replacement);
    expect(stored('p1')?.verifiedAccount).toBeUndefined();
  });

  it('claims nothing about an account for a profile that was just created', async () => {
    await api()
      .post('/api/config/ssh')
      .send({ id: 'fresh', label: 'New', privateKeyPath: makeKey('id_new') })
      .expect(200);

    expect(stored('fresh')?.verifiedAccount).toBeUndefined();
  });

  it('does not inherit a deleted profile’s account when the id is reused', async () => {
    const first = makeKey('id_first');
    const second = makeKey('id_second');

    await api()
      .post('/api/config/ssh')
      .send({ id: 'recycled', label: 'First', privateKeyPath: first })
      .expect(200);

    const config = readConfig();
    const entry = config.sshProfiles.find((profile) => profile.id === 'recycled');
    if (entry) {
      entry.verifiedAccount = 'someone-else';
    }
    writeConfig(config);

    await api().delete('/api/config/ssh').send({ id: 'recycled' }).expect(200);
    expect(stored('recycled')).toBeUndefined();

    await api()
      .post('/api/config/ssh')
      .send({ id: 'recycled', label: 'Second', privateKeyPath: second })
      .expect(200);

    expect(stored('recycled')?.verifiedAccount).toBeUndefined();
  });
});
