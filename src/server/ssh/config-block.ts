// Maintains a clearly-marked managed block inside the user's ~/.ssh/config so
// external tools (Git Bash, plain `git`, IDEs) pick up the same key that is
// active in Multi-Git. Only the text between the BEGIN/END markers is ever
// touched; everything the user wrote stays byte-identical.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeFileAtomic } from '../fs/atomic';

export const MARK_BEGIN = '# BEGIN multi-git managed block (do not edit inside)';
export const MARK_END = '# END multi-git managed block';

/** Host name to private key path. */
export type SshHostsMap = Record<string, string>;

export interface ApplyResult {
  changed: boolean;
  warning: string | null;
}

export function getSshDir(): string {
  return path.join(os.homedir(), '.ssh');
}

export function getSshConfigPath(): string {
  return path.join(getSshDir(), 'config');
}

export interface ManagedBlockInput {
  /**
   * Catch-all entries: `Host <host>` naming the default account.
   *
   * One host may have at most one, which is the whole difficulty — it makes
   * exactly one profile the machine-wide answer for that host. It is written
   * only from an explicit choice of default account, never as a side effect of
   * opening a repository.
   */
  defaults: SshHostsMap;
  /** `Host <host>-<label>` entries, one per profile. Never a default. */
  aliases?: SshHostsMap;
}

/** The real host an alias entry should connect to. Identity for a catch-all. */
export type HostNameResolver = (host: string) => string;

export function renderManagedBlock(
  input: SshHostsMap | ManagedBlockInput,
  hostNameFor: HostNameResolver = (host) => host
): string {
  const { defaults, aliases } = isBlockInput(input) ? input : { defaults: input, aliases: {} };
  const lines: string[] = [MARK_BEGIN];

  const entries: SshHostsMap = { ...(aliases ?? {}), ...defaults };

  for (const host of Object.keys(entries).sort()) {
    const keyPath = String(entries[host]).replace(/\\/g, '/');
    lines.push(`Host ${host}`);
    lines.push(`  HostName ${hostNameFor(host)}`);
    lines.push(`  IdentityFile "${keyPath}"`);
    lines.push('  IdentitiesOnly yes');
  }

  lines.push(MARK_END);
  return lines.join('\n');
}

function isBlockInput(value: SshHostsMap | ManagedBlockInput): value is ManagedBlockInput {
  return typeof value === 'object' && value !== null && 'defaults' in value;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces, or removes when `hostsMap` is empty, the managed block.
 *
 * The block always lives at the TOP of the file: OpenSSH options are
 * first-match-wins, so this is the only placement that guarantees the active
 * key actually beats a pre-existing user Host entry. Users who do not want
 * that turn the feature off in the app.
 */
export function applyManagedBlock(
  input: SshHostsMap | ManagedBlockInput,
  hostNameFor: HostNameResolver = (host) => host
): ApplyResult {
  const sshDir = getSshDir();
  const configPath = getSshConfigPath();

  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }

  let content = '';
  let fileExisted = false;
  if (fs.existsSync(configPath)) {
    fileExisted = true;
    content = fs.readFileSync(configPath, 'utf8');
  }

  const entryCount = isBlockInput(input)
    ? Object.keys(input.defaults).length + Object.keys(input.aliases ?? {}).length
    : Object.keys(input).length;

  const wantBlock = entryCount > 0;
  const block = wantBlock ? renderManagedBlock(input, hostNameFor) : '';
  const blockRegex = new RegExp(`${escapeRegExp(MARK_BEGIN)}[\\s\\S]*?${escapeRegExp(MARK_END)}\\n?`);

  let warning: string | null = null;
  const hasBegin = content.includes(MARK_BEGIN);
  const hasEnd = content.includes(MARK_END);

  // Strip the current block wherever it is, leaving user content untouched.
  let remainder = content;
  if (hasBegin && hasEnd && blockRegex.test(content)) {
    remainder = content.replace(blockRegex, '').replace(/\n{3,}/g, '\n\n');
  } else if (hasBegin || hasEnd) {
    // One marker missing means the block was hand-edited. Never guess at the
    // boundaries of something the user broke.
    warning =
      'Found an incomplete multi-git block in ~/.ssh/config; left it in place and wrote a fresh block at the top.';
  } else if (!wantBlock) {
    return { changed: false, warning: null };
  }
  remainder = remainder.replace(/^\n+/, '');

  let next: string;
  if (!wantBlock) {
    next = remainder.trim() === '' ? '' : remainder;
  } else if (remainder === '') {
    next = `${block}\n`;
  } else {
    next = `${block}\n\n${remainder}`;
  }

  if (next === content) {
    return { changed: false, warning };
  }

  // 0600 because an ssh config names key paths and host aliases.
  writeFileAtomic(configPath, next, { mode: 0o600 });

  if (!fileExisted && process.platform !== 'win32') {
    fs.chmodSync(configPath, 0o600);
  }

  return { changed: true, warning };
}

export function removeManagedBlock(): ApplyResult {
  return applyManagedBlock({ defaults: {}, aliases: {} });
}
