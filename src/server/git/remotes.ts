// Reading and changing remotes.
//
// The listing does not parse `git remote -v`. That output is two lines per
// remote with a trailing "(fetch)"/"(push)" marker, it says nothing about
// refspecs or prune, and a URL containing a space is indistinguishable from
// the column separator. `git config --get-regexp` over the `remote.*` keys is
// the actual record, is machine-readable, and answers every field at once.
//
// URL rewriting stays in ./remote.ts, which already knows which shapes this app
// can round-trip. Nothing here reimplements it.
import { runGitCommand, tryGitCommand, GitError } from './run';
import { InvalidGitArgumentError } from './args';
import type {
  AddRemoteInput,
  RemoteConnectivity,
  RemoteInfo,
  RemotePrunePreview,
  UpdateRemoteInput
} from '../../shared/remote-types';

/** Raised for a request git would either refuse or misinterpret. */
export class RemoteError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RemoteError';
    this.statusCode = statusCode;
  }
}

/**
 * Validates a remote name.
 *
 * Git's own rule is that a remote name is a ref path component, so this is
 * `check-ref-format` territory. The leading-hyphen rule is the one that
 * matters beyond tidiness: `git remote add --upload-pack=... url` would be
 * read as a flag, not a name.
 */
export function remoteNameArg(value: unknown, label = 'Remote name'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidGitArgumentError(`${label} is required.`);
  }

  const name = value.trim();

  if (name.startsWith('-')) {
    throw new InvalidGitArgumentError(`${label} may not start with "-".`);
  }
  if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name)) {
    throw new InvalidGitArgumentError(
      `"${name}" is not a usable remote name. Use letters, digits, dots, underscores, hyphens and slashes.`
    );
  }
  if (name.includes('..') || name.endsWith('.lock') || name.endsWith('/')) {
    throw new InvalidGitArgumentError(`${label} contains a sequence Git reserves.`);
  }

  return name;
}

/**
 * Validates a remote URL.
 *
 * Deliberately not a URL parser: git accepts scp-like syntax, `file://`, bare
 * paths and transport helpers, and rejecting those would be rejecting valid
 * setups. What is refused is what would misbehave as an argument or corrupt
 * the config file it is written into.
 */
export function remoteUrlArg(value: unknown, label = 'Remote URL'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidGitArgumentError(`${label} is required.`);
  }

  const url = value.trim();

  if (url.startsWith('-')) {
    throw new InvalidGitArgumentError(`${label} may not start with "-".`);
  }
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw new InvalidGitArgumentError(`${label} may not contain control characters.`);
    }
  }

  // `ext::` hands git an arbitrary command to run as its transport. It is a
  // real git feature, and it is also a way to turn "add a remote" into "run
  // this program on every fetch", which is not a capability this UI offers.
  if (/^ext::/i.test(url)) {
    throw new InvalidGitArgumentError(
      'ext:: remotes run an arbitrary command as their transport and are not supported here.'
    );
  }

  return url;
}

function refspecArg(value: unknown, label = 'Refspec'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidGitArgumentError(`${label} is required.`);
  }

  const refspec = value.trim();

  // A leading `+` means "force", and is the one legitimate leading punctuation.
  if (refspec.startsWith('-')) {
    throw new InvalidGitArgumentError(`${label} may not start with "-".`);
  }
  if (/[\s]/.test(refspec)) {
    throw new InvalidGitArgumentError(`${label} may not contain whitespace.`);
  }

  return refspec;
}

// ---------- reading ----------

/**
 * Every `remote.*` and `fetch.prune` setting, as key/value pairs.
 *
 * `--get-regexp` with `-z` gives one NUL-terminated record per key, where the
 * key and value are separated by the first newline. That is the only form that
 * survives a value containing whitespace.
 */
async function readRemoteConfig(repoPath: string): Promise<Map<string, string[]>> {
  const result = await tryGitCommand(repoPath, [
    'config',
    '--get-regexp',
    '-z',
    '^(remote\\.|fetch\\.prune)'
  ]);

  const entries = new Map<string, string[]>();
  if (!result) {
    return entries;
  }

  for (const record of result.stdout.split('\0')) {
    if (record === '') {
      continue;
    }

    const newline = record.indexOf('\n');
    const key = (newline === -1 ? record : record.slice(0, newline)).toLowerCase();
    const value = newline === -1 ? '' : record.slice(newline + 1);

    const existing = entries.get(key);
    if (existing) {
      existing.push(value);
    } else {
      entries.set(key, [value]);
    }
  }

  return entries;
}

function first(entries: Map<string, string[]>, key: string): string | undefined {
  return entries.get(key)?.[0];
}

/**
 * The remotes of a repository, with everything that changes what they do.
 *
 * Names come from `git remote` rather than from the config keys, because a
 * remote whose section exists but whose URL does not is not a remote git will
 * act on, and listing it would offer actions that cannot work.
 */
export async function listRemotes(repoPath: string): Promise<RemoteInfo[]> {
  const listing = await tryGitCommand(repoPath, ['remote']);
  if (!listing) {
    return [];
  }

  const names = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const config = await readRemoteConfig(repoPath);
  const inheritedPrune = first(config, 'fetch.prune') === 'true';
  const defaultPush = first(config, 'remote.pushdefault');

  return names.map((name) => {
    const key = name.toLowerCase();
    const fetchUrl = first(config, `remote.${key}.url`) ?? '';
    const pushUrl = first(config, `remote.${key}.pushurl`) ?? fetchUrl;
    const prune = first(config, `remote.${key}.prune`);

    return {
      name,
      fetchUrl,
      pushUrl,
      fetchRefspecs: config.get(`remote.${key}.fetch`) ?? [],
      pushRefspecs: config.get(`remote.${key}.push`) ?? [],
      prune: prune === undefined ? inheritedPrune : prune === 'true',
      pruneInherited: prune === undefined,
      isDefaultPush: defaultPush === name
    };
  });
}

export async function findRemote(repoPath: string, name: string): Promise<RemoteInfo | null> {
  const remotes = await listRemotes(repoPath);
  return remotes.find((remote) => remote.name === name) ?? null;
}

async function requireRemote(repoPath: string, name: unknown): Promise<RemoteInfo> {
  const validated = remoteNameArg(name);
  const remote = await findRemote(repoPath, validated);

  if (!remote) {
    throw new RemoteError(`This repository has no remote named "${validated}".`, 404);
  }

  return remote;
}

// ---------- writing ----------

/** Replaces a remote's multi-valued config key with exactly the values given. */
async function setRefspecs(
  repoPath: string,
  name: string,
  which: 'fetch' | 'push',
  refspecs: readonly string[]
): Promise<void> {
  const key = `remote.${name}.${which}`;

  // Unset first: `--add` alone would append to whatever is already there, and
  // an editor that only ever adds cannot remove a refspec.
  await tryGitCommand(repoPath, ['config', '--unset-all', key]);

  for (const refspec of refspecs) {
    await runGitCommand(repoPath, ['config', '--add', key, refspecArg(refspec)]);
  }
}

export async function addRemote(repoPath: string, input: AddRemoteInput): Promise<RemoteInfo> {
  const name = remoteNameArg(input.name);
  const fetchUrl = remoteUrlArg(input.fetchUrl);

  if (await findRemote(repoPath, name)) {
    throw new RemoteError(`This repository already has a remote named "${name}".`);
  }

  await runGitCommand(repoPath, ['remote', 'add', name, fetchUrl]);

  // Everything else is applied through the same path an edit takes, so there
  // is one implementation of "make the remote look like this".
  await applyRemoteOptions(repoPath, name, input);

  const created = await findRemote(repoPath, name);
  if (!created) {
    throw new RemoteError('The remote was added but could not be read back.', 500);
  }

  return created;
}

async function applyRemoteOptions(
  repoPath: string,
  name: string,
  input: Partial<AddRemoteInput>
): Promise<void> {
  if (input.pushUrl !== undefined) {
    if (input.pushUrl.trim() === '') {
      // Empty means "push where you fetch", which is the absence of the key
      // rather than an empty one.
      await tryGitCommand(repoPath, ['config', '--unset-all', `remote.${name}.pushurl`]);
    } else {
      await runGitCommand(repoPath, [
        'remote',
        'set-url',
        '--push',
        name,
        remoteUrlArg(input.pushUrl, 'Push URL')
      ]);
    }
  }

  if (input.fetchRefspecs !== undefined) {
    await setRefspecs(repoPath, name, 'fetch', input.fetchRefspecs);
  }
  if (input.pushRefspecs !== undefined) {
    await setRefspecs(repoPath, name, 'push', input.pushRefspecs);
  }

  if (input.prune !== undefined) {
    await runGitCommand(repoPath, ['config', `remote.${name}.prune`, String(input.prune)]);
  }
}

export async function updateRemote(repoPath: string, input: UpdateRemoteInput): Promise<RemoteInfo> {
  const existing = await requireRemote(repoPath, input.name);
  let name = existing.name;

  if (input.newName !== undefined && input.newName !== name) {
    const renamed = remoteNameArg(input.newName, 'New remote name');

    if (await findRemote(repoPath, renamed)) {
      throw new RemoteError(`This repository already has a remote named "${renamed}".`);
    }

    // `git remote rename` also rewrites the refspecs and every branch's
    // `branch.<name>.remote`, which is why it is used instead of moving the
    // config section by hand.
    await runGitCommand(repoPath, ['remote', 'rename', name, renamed]);
    name = renamed;
  }

  if (input.fetchUrl !== undefined) {
    await runGitCommand(repoPath, ['remote', 'set-url', name, remoteUrlArg(input.fetchUrl)]);
  }

  await applyRemoteOptions(repoPath, name, input);

  const updated = await findRemote(repoPath, name);
  if (!updated) {
    throw new RemoteError('The remote was changed but could not be read back.', 500);
  }

  return updated;
}

export async function removeRemote(repoPath: string, name: unknown): Promise<RemoteInfo> {
  const remote = await requireRemote(repoPath, name);

  await runGitCommand(repoPath, ['remote', 'remove', remote.name]);
  return remote;
}

export async function setDefaultPushRemote(repoPath: string, name: unknown): Promise<void> {
  if (name === null || name === '') {
    await tryGitCommand(repoPath, ['config', '--unset-all', 'remote.pushDefault']);
    return;
  }

  const remote = await requireRemote(repoPath, name);
  await runGitCommand(repoPath, ['config', 'remote.pushDefault', remote.name]);
}

// ---------- prune ----------

/**
 * The remote-tracking refs a prune would delete.
 *
 * `--dry-run` prints "would prune <ref>" — human text, which is why only the
 * final whitespace-separated token is taken and the prose around it ignored.
 * Under `LC_ALL=C` the shape is stable even where the wording is not.
 */
export async function previewRemotePrune(
  repoPath: string,
  name: unknown
): Promise<RemotePrunePreview> {
  const remote = await requireRemote(repoPath, name);

  const result = await runGitCommand(
    repoPath,
    ['remote', 'prune', '--dry-run', remote.name],
    null,
    { envOverrides: { LC_ALL: 'C', LANG: 'C' } }
  );

  const staleRefs = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /would prune/i.test(line))
    .map((line) => line.split(/\s+/).pop() ?? '')
    .filter((ref) => ref !== '');

  return { remote: remote.name, staleRefs };
}

export async function pruneRemote(repoPath: string, name: unknown): Promise<void> {
  const remote = await requireRemote(repoPath, name);
  await runGitCommand(repoPath, ['remote', 'prune', remote.name]);
}

// ---------- connectivity ----------

/** Errors whose text means "the host said no", not "the host was not there". */
const AUTH_FAILURE = /permission denied|authentication failed|access denied|could not read Username|publickey/i;

/**
 * Reaches a remote and reports what happened.
 *
 * `--exit-code` is what makes an empty repository succeed rather than looking
 * like a failure. The caller is responsible for having made the SSH identity
 * usable first; this only reports what git saw.
 */
export async function testRemote(
  repoPath: string,
  name: unknown,
  options: { sshKeyPath?: string | null; signal?: AbortSignal } = {}
): Promise<RemoteConnectivity> {
  const remote = await requireRemote(repoPath, name);

  try {
    const result = await runGitCommand(
      repoPath,
      ['ls-remote', '--exit-code', '--quiet', remote.name],
      options.sshKeyPath ?? null,
      {
        signal: options.signal,
        // A host that accepts the connection and then never answers would
        // otherwise hold the panel open for the default timeout.
        timeoutMs: 30_000,
        envOverrides: {
          LC_ALL: 'C',
          LANG: 'C',
          // Without this a remote needing a password blocks on a prompt that
          // nothing is reading, and the check hangs until the timeout.
          GIT_TERMINAL_PROMPT: '0'
        }
      }
    );

    const refCount = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length;
    return { remote: remote.name, reachable: true, refCount };
  } catch (error) {
    // GitError already carries redacted output; runProcess redacts before it
    // ever reaches here.
    const message = error instanceof GitError ? error.displayMessage : String(error);

    return {
      remote: remote.name,
      reachable: false,
      message,
      authFailure: AUTH_FAILURE.test(message)
    };
  }
}
