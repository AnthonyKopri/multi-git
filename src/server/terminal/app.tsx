import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { actionGroups, actions, parseFields } from './actions';
import type { Action, Field } from './actions';
import { initialNavigation, navigate, leaderBindings, terminalText, validateBindings } from './navigation';
import type { Navigation } from './navigation';
import { connectBackend } from '../runtime/connection';
import type { BackendConnection } from '../runtime/connection';
import { prepareRequest, executeRequest, serverOrigin } from '../agent-cli/client';
import { autoPullBlockedReason } from '../../shared/auto-pull';
import type { StatusResponse } from '../../shared/api-types';
import type { ClientConfig } from '../../shared/config-types';
import type { DiffFile } from '../../shared/diff-types';
import type { RebasePlan } from '../../shared/rebase-types';
import { appVersion } from '../app-root';

type Data = Record<string, unknown>;
interface Row { id: string; label: string; data: unknown; action?: Action }
interface View { title: string; rows: Row[]; kind: string; details?: unknown; file?: string; source?: string; plan?: RebasePlan }
interface Form { action: Action; fields: Field[]; values: Record<string, string>; input?: Data }
interface Pending { action: Action; input: Data; preview: unknown }
const planRows = (plan: RebasePlan): Row[] => [...plan.items.map((entry) => ({ id: entry.oid, label: `${entry.action.padEnd(7)} ${entry.subject}`, data: entry })), { id: 'apply-plan', label: 'Review and apply this plan', data: 'Replay commits using the plan above. Confirmation follows.' }];
interface Preferences { theme: string; ascii: boolean; bindings: Record<string, string> }
const defaults: Preferences = { theme: 'terminal', ascii: false, bindings: leaderBindings };
const record = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const description = (value: unknown): string => {
  if (typeof value !== 'object' || value === null) return terminalText(value);
  const data = record(value);
  return terminalText(data['label'] ?? data['name'] ?? data['path'] ?? data['repoPath'] ?? data['message'] ?? data['subject'] ?? data['ref'] ?? data['branch'] ?? data['id'] ?? data['hash'] ?? Object.keys(data).join(' · '));
};
function resultRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.map((entry, index) => ({ id: String(record(entry)['id'] ?? index), label: description(entry), data: entry }));
  const data = record(value);
  const list = Object.entries(data).find(([key, item]) => key !== 'warnings' && Array.isArray(item));
  if (list) return resultRows(list[1]);
  return Object.entries(data).filter(([key]) => key !== 'success').map(([key, item]) => ({ id: key, label: `${key}: ${description(item)}`, data: item }));
}
function details(value: unknown, depth = 0): string {
  if (depth > 5) return '…';
  if (Array.isArray(value)) return value.map((entry) => details(entry, depth + 1)).join('\n');
  if (value !== null && typeof value === 'object') return Object.entries(record(value)).filter(([key]) => !/passphrase|masterKey|token/i.test(key))
    .map(([key, entry]) => `${key}: ${typeof entry === 'object' ? '\n' : ''}${details(entry, depth + 1)}`).join('\n');
  return terminalText(value);
}
/** VISUAL or EDITOR, as a program and its arguments: "code -w" is a common value. */
function editorCommand(): string[] {
  const configured = (process.env['VISUAL'] || process.env['EDITOR'] || '').trim();
  if (configured) {
    return (configured.match(/"[^"]*"|'[^']*'|\S+/g) ?? [configured]).map((part) => part.replace(/^["']|["']$/g, ''));
  }
  return [process.platform === 'win32' ? 'notepad.exe' : 'vi'];
}

/** The words people type for the everyday workflows, straight to the action. */
const ALIASES: Record<string, string> = {
  fetch: 'fetch', pull: 'pull', push: 'push', publish: 'push', commit: 'commit',
  ssh: 'accounts', account: 'accounts', accounts: 'accounts', 'auto-pull': 'auto-pull', autopull: 'auto-pull',
  worktree: 'worktrees', worktrees: 'worktrees', recover: 'recovery', recovery: 'recovery', undo: 'recovery',
  settings: 'settings', branch: 'branches', branches: 'branches', stash: 'stashes', log: 'history', history: 'history',
  changes: 'files', status: 'files', operations: 'operations', clone: 'clone', repo: 'repositories', repos: 'repositories'
};

/**
 * Actions for what was typed after ":". Every word has to appear somewhere in
 * the action's name, group, keywords or description, so "change account" finds
 * the account switcher; an alias or an exact name comes first.
 */
export function paletteMatches(query: string): Action[] {
  const text = query.toLowerCase().replace(/^:/, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  const alias = ALIASES[text];
  return actions
    .map((action, order) => {
      const haystack = `${action.id} ${action.title} ${action.group} ${action.keywords ?? ''} ${action.description}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) {
        return null;
      }
      const title = action.title.toLowerCase();
      const score = (alias === action.id ? 100 : 0) + (action.id === text ? 50 : 0) +
        (text && title.startsWith(text) ? 20 : 0) + (text && action.id.startsWith(text) ? 10 : 0);
      return { action, score, order };
    })
    .filter((entry): entry is { action: Action; score: number; order: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.action);
}

/** Plain ASCII, for terminals and fonts without the typographic characters. */
export function asciiOnly(text: string): string {
  return text
    .replace(/[·•]/g, '|').replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/↑/g, '^').replace(/↓/g, 'v').replace(/›/g, '>').replace(/█/g, '_').replace(/↵/g, '/');
}

function client(origin: string, repo: () => string): (method: string, endpoint: string, input?: Data) => Promise<unknown> {
  const base = serverOrigin(origin);
  return async (method, endpoint, input = {}) => {
    const url = new URL(endpoint, base);
    if (url.origin !== base || !url.pathname.startsWith('/api/')) throw new Error('Invalid application endpoint.');
    if (method === 'GET') for (const [key, value] of Object.entries(input)) if (value !== undefined) url.searchParams.set(key, String(value));
    const folder = repo();
    const headers = { 'Content-Type': 'application/json', ...(folder ? { 'x-repo-path': Buffer.from(folder).toString('base64'), 'x-repo-path-encoding': 'base64' } : {}) };
    const response = await fetch(url, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(input) }), redirect: 'error', signal: AbortSignal.timeout(15 * 60_000) });
    const payload: unknown = await response.json();
    if (!response.ok || record(payload)['success'] === false) throw new Error(String(record(payload)['error'] ?? `HTTP ${response.status}`));
    return payload;
  };
}

export function Terminal({ connection, initialRepo }: { connection: BackendConnection; initialRepo: string }): React.ReactNode {
  const { exit, suspendTerminal } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ width: stdout.columns || 80, height: stdout.rows || 24 });
  const [repo, setRepo] = useState(initialRepo);
  const repoRef = useRef(repo); repoRef.current = repo;
  const api = useRef(client(connection.origin, () => repoRef.current)).current;
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [preferences, setPreferences] = useState(defaults);
  const [view, setView] = useState<View>({ title: 'Welcome to Multi-Git', kind: 'home', rows: [] });
  const history = useRef<{ view: View; navigation: Navigation; filter: string; detailOffset: number }[]>([]);
  const [navigation, setNavigation] = useState<Navigation>(initialNavigation());
  const [message, setMessage] = useState('Space opens actions · : finds any workflow · ? explains keys');
  const [busy, setBusy] = useState(false);
  const running = useRef(0);
  const [form, setForm] = useState<Form | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState<'palette' | 'search' | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [detailOffset, setDetailOffset] = useState(0);
  /** The repository's SSH account as the backend reports it, for the header. */
  const [account, setAccount] = useState<{ profileId: string; keepIdentity: boolean } | null>(null);
  const epoch = useRef(0);
  const page = Math.max(5, size.height - 11);
  const groups = actionGroups;
  const [groupIndex, setGroupIndex] = useState(0);
  const color = process.env['NO_COLOR'] !== undefined || preferences.theme === 'mono' ? undefined : preferences.theme === 'light' ? 'blue' : 'cyan';
  useEffect(() => setAsciiOutput(preferences.ascii), [preferences.ascii]);
  const glyph = preferences.ascii || process.env['TERM'] === 'dumb'
    ? { marker: '>', up: '^', down: 'v', dot: '|', cursor: '_', newline: ' / ', border: 'classic' as const, frame: 'classic' as const }
    : { marker: '›', up: '↑', down: '↓', dot: '·', cursor: '█', newline: ' ↵ ', border: 'round' as const, frame: 'single' as const };
  const marker = glyph.marker;
  const pushView = (next: View, remember = true): void => {
    if (remember) history.current.push({ view, navigation, filter, detailOffset });
    setView(next); setNavigation(initialNavigation()); setFilter(''); setDetailOffset(0);
  };
  const run = (task: () => Promise<void>, inspect = false): void => {
    if (running.current > 0 && !inspect) { setMessage('A change is still running. Space o shows progress and cancellation.'); return; }
    running.current++;
    setBusy(true);
    void task().catch((error) => setMessage(`${error instanceof Error ? error.message : String(error)} · Inspect status before retrying an uncertain write.`)).finally(() => { running.current--; setBusy(running.current > 0); });
  };
  const readContext = async (): Promise<void> => {
    const current = repoRef.current;
    const next = await api('GET', '/api/config') as ClientConfig;
    setConfig(next);
    if (current) {
      const [nextStatus, nextAccount] = await Promise.all([
        api('GET', '/api/git/status') as Promise<StatusResponse>,
        (api('GET', '/api/workflows/ssh') as Promise<{ profileId: string; keepIdentity: boolean }>).catch(() => null)
      ]);
      if (repoRef.current === current) {
        setStatus(nextStatus);
        setAccount(nextAccount);
      }
    }
  };
  const showFiles = async (remember = true): Promise<void> => {
    if (!repoRef.current) { showRepositories(); return; }
    const current = repoRef.current;
    const state = await api('GET', '/api/git/status') as StatusResponse;
    if (repoRef.current !== current) return;
    setStatus(state);
    const rows: Row[] = [
      ...state.conflicts.map((entry) => ({ id: `conflict:${entry.path}`, label: `CONFLICT  ${entry.path}`, data: { ...entry, source: 'conflict' } })),
      ...state.unstaged.map((entry) => ({ id: `work:${entry.path}`, label: `  ${entry.status}  ${entry.path}`, data: { ...entry, source: 'working-tree' } })),
      ...state.staged.map((entry) => ({ id: `index:${entry.path}`, label: `+ ${entry.status}  ${entry.path}`, data: { ...entry, source: 'index' } }))
    ];
    const next = { title: 'Changes · s stage / u unstage · Enter inspect', kind: 'files', rows, details: rows.length ? undefined : 'Working tree clean. Space f fetches remote changes; Space b switches branches.' };
    if (remember) pushView(next); else setView(next);
  };
  const showRepositories = (): void => pushView({ title: 'Repositories', kind: 'repositories', rows: [
    ...(config?.recentRepos ?? []).map((folder) => ({ id: folder, label: folder, data: folder })),
    ...actions.filter((action) => ['open-repository', 'clone', 'new-repository'].includes(action.id)).map((action) => ({ id: action.id, label: action.title, data: action.description, action }))
  ] });
  useEffect(() => {
    const resize = (): void => setSize({ width: stdout.columns || 80, height: stdout.rows || 24 });
    stdout.on('resize', resize);
    void connection.call<Preferences>('preferences.read').then(setPreferences).catch(() => {});
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  useEffect(() => {
    const current = ++epoch.current;
    run(async () => {
      await readContext();
      if (epoch.current !== current) return;
      if (repo) await showFiles(false);
      else setView({ title: 'Welcome · choose a repository to begin', kind: 'home', rows: actions.filter((action) => ['repositories', 'open-repository', 'clone', 'new-repository', 'doctor', 'accounts', 'settings'].includes(action.id)).map((action) => ({ id: action.id, label: action.title, data: action.description, action })) });
    }, true);
  }, [repo]);
  useEffect(() => {
    if (view.kind !== 'operations') return;
    const timer = setInterval(() => {
      void api('GET', '/api/operations').then((data) => setView((current) => current.kind === 'operations' ? { ...current, rows: resultRows(data), details: data } : current)).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [view.kind]);

  const execute = async (action: Action, input: Data): Promise<void> => {
    let result: unknown;
    if (action.id === 'appearance' || action.id === 'keymap') {
      const next = { ...preferences, bindings: { ...preferences.bindings } };
      if (action.id === 'appearance') { next.theme = String(input['theme']); next.ascii = input['ascii'] === true; }
      else {
        const key = String(input['key']); const target = String(input['action']);
        for (const [existing, assigned] of Object.entries(next.bindings)) if (assigned === target) delete next.bindings[existing];
        if (next.bindings[key]) throw new Error(`Leader ${key} is already assigned to ${next.bindings[key]}. Choose an unused key.`);
        next.bindings[key] = target;
        const error = validateBindings(next.bindings); if (error) throw new Error(error);
      }
      await connection.call('preferences.write', next); setPreferences(next); result = next;
    } else if (action.command) {
      result = await executeRequest(prepareRequest([action.command, '--server', connection.origin, '--allow-write', ...(repo ? ['--repo', repo] : [])], input));
    } else if (action.privateMethod) result = await connection.call(action.privateMethod, { ...input, repoPath: repo });
    else result = await api(action.method ?? 'GET', action.path!, input);
    setForm(null); setPending(null); setNavigation(initialNavigation());
    setMessage(`${action.title} completed.`);
    if (action.id === 'open-repository' || action.id === 'clone' || action.id === 'new-repository') {
      const folder = String(record(result)['repoPath'] ?? input['repoPath']);
      if (folder) { setRepo(folder); return; }
    }
    await readContext();
    if (action.id === 'rebase-plan') {
      const plan = record(result)['plan'] as RebasePlan;
      pushView({ title: 'Rebase plan · Enter changes an action · J/K reorder', kind: 'rebase-plan', plan, details: record(result)['warning'], rows: planRows(plan) });
    } else if (action.id === 'conflict') {
      const resolve: Action = { id: 'resolve', title: 'Edit and resolve conflict', group: 'Integrate', path: '/api/git/conflict/resolve', method: 'POST', description: 'Edit the contents, remove conflict markers, then review and confirm to save and stage this file.', fields: [{ name: 'filePath', label: 'Conflicted file', value: String(input['path']) }, { name: 'resolvedContent', label: 'Resolved content (Ctrl+e opens editor)', kind: 'multiline', allowEmpty: true, value: String(record(result)['rawContent'] ?? '') }] };
      pushView({ title: `Conflict: ${input['path']}`, kind: 'conflict', file: String(input['path']), rows: [{ id: 'resolve', label: resolve.title, action: resolve, data: resolve.description }, ...resultRows(result)], details: result });
    } else if (['stage', 'unstage', 'commit', 'amend', 'fetch', 'pull', 'push'].includes(action.id)) await showFiles(false);
    else pushView({ title: action.title, kind: action.id, rows: resultRows(result), details: result });
  };
  const review = async (action: Action, input: Data): Promise<void> => {
    if (action.method === 'GET') { await execute(action, input); return; }
    let preview: unknown = { repository: repo || 'Application settings', ...Object.fromEntries(Object.entries(input).map(([key, value]) => [key, action.fields?.some((f) => f.name === key && f.kind === 'secret') ? '(hidden)' : value])) };
    if (['pull', 'merge', 'rebase'].includes(action.id)) {
      const state = await api('GET', '/api/git/status') as StatusResponse;
      const target = input['branch'] ?? state.tracking;
      preview = await api('GET', '/api/git/integrate/preflight', { kind: action.id, target });
      const blocked = record(record(preview)['preflight'])['blocked']; if (blocked) throw new Error(String(blocked));
    }
    if (action.id === 'commit' || action.id === 'amend') {
      const state = await api('GET', '/api/git/status') as StatusResponse;
      preview = { stagedFiles: state.staged, author: await api('GET', '/api/git/identity'), message: input['message'], warning: 'This commits the entire index, including previously staged changes.' };
    }
    if (action.id === 'push') preview = { origin: await api('GET', '/api/git/remote/origin'), status: await api('GET', '/api/git/status'), account: await api('GET', '/api/workflows/ssh'), verification: await api('POST', '/api/workflows/ssh/verify') };
    if (action.id === 'ssh-select') preview = await api('GET', '/api/workflows/ssh', { profileId: input['profileId'] });
    if (action.id === 'remote-toggle') preview = await api('GET', '/api/git/remote/origin');
    if (action.id === 'lfs-transfer') preview = await api('GET', '/api/lfs/preview', { action: input['action'] });
    if (action.id === 'remote-prune') preview = await api('GET', '/api/remotes/prune-preview', input);
    setForm(null); setPending({ action, input, preview }); setNavigation(initialNavigation()); setDetailOffset(0);
  };
  const begin = async (action: Action): Promise<void> => {
    if (action.repo && !repo) { setMessage('Open a repository first: Space r.'); return; }
    if (action.id === 'repositories') { showRepositories(); return; }
    if (action.id === 'files') { await showFiles(); return; }
    if (action.id === 'branches') {
      const data = record(await api('GET', '/api/git/branches'));
      pushView({ title: 'Switch branch', kind: 'branches', rows: ['local', 'remote'].flatMap((kind) => (data[kind] as string[]).map((branch) => ({ id: `${kind}:${branch}`, label: `${kind === 'local' ? 'Local ' : 'Remote'}  ${branch}`, data: { branch, isRemote: kind === 'remote' } }))) }); return;
    }
    if (action.id === 'accounts') {
      const next = await api('GET', '/api/config') as ClientConfig;
      pushView({ title: 'Choose SSH / account', kind: 'accounts', rows: [{ id: '', label: 'System SSH · use your existing configuration', data: { id: '' } }, ...next.sshProfiles.map((profile) => ({ id: profile.id, label: `${profile.label} · ${profile.verifiedAccount ?? 'not verified'} · ${profile.userEmail || 'no author email'}`, data: profile })), ...actions.filter((a) => ['ssh-generate', 'ssh-save', 'ssh-public', 'ssh-verify', 'ssh-load', 'vault-unlock'].includes(a.id)).map((a) => ({ id: a.id, label: a.title, action: a, data: a.description }))] }); return;
    }
    if (action.id === 'settings') {
      const extras: Action[] = [
        { id: 'appearance', title: 'Appearance', group: 'System', description: 'Use terminal colors, an explicit theme, or monochrome.', privateMethod: 'preferences.write', fields: [{ name: 'theme', label: 'Theme', choices: ['terminal', 'light', 'dark', 'mono'], value: preferences.theme }, { name: 'ascii', label: 'ASCII characters only', kind: 'boolean', value: String(preferences.ascii) }] },
        { id: 'keymap', title: 'Remap a leader shortcut', group: 'System', description: 'Assign an unused key; every action remains available through the palette.', privateMethod: 'preferences.write', fields: [{ name: 'action', label: 'Action', choices: Object.values(leaderBindings) }, { name: 'key', label: 'New single letter or digit' }] }
      ];
      pushView({ title: 'Settings', kind: 'settings', rows: [...extras, ...actions.filter((a) => ['auto-pull', 'accounts', 'ssh-save', 'ssh-rule', 'vault-unlock', 'vault-lock', 'doctor', 'tools', 'agents'].includes(a.id))].map((a) => ({ id: a.id, label: a.title, action: a, data: a.description })) }); return;
    }
    const fields = action.fields ?? [];
    if (fields.length) {
      const values = Object.fromEntries(fields.map((entry) => [entry.name, entry.value ?? (entry.kind === 'boolean' ? 'false' : entry.choices?.[0] ?? '')]));
      if (action.id === 'auto-pull') values['enabled'] = String(!config?.settings.autoPull);
      if (action.id === 'application-settings') Object.assign(values, {
        manageSshConfig: String(config?.settings.manageSshConfig ?? false), isolateSshConfig: String(config?.settings.isolateSshConfig ?? true),
        recoveryRetentionDays: String(config?.settings.recoveryRetentionDays ?? 30), worktreeParentDir: config?.settings.worktreeParentDir ?? ''
      });
      const selected = record(visibleRows[navigation.index]?.data);
      for (const entry of fields) if (selected[entry.name] !== undefined && typeof selected[entry.name] === 'string') values[entry.name] = selected[entry.name] as string;
      setForm({ action, fields, values }); setNavigation(initialNavigation()); setEditing(false);
    } else if (action.method === 'GET') await execute(action, {});
    else await review(action, {});
  };
  const open = async (row: Row | undefined): Promise<void> => {
    if (!row) return;
    if (row.action) { await begin(row.action); return; }
    if (view.kind === 'operations' && ['running', 'queued'].includes(String(record(row.data)['state']))) {
      await review(actions.find((a) => a.id === 'operation-cancel')!, { id: row.id }); return;
    }
    if (view.kind === 'repositories') { setRepo(String(row.data)); return; }
    if (view.kind === 'branches') {
      await review({ id: 'checkout', title: 'Switch branch', group: 'Branches', command: 'branches.checkout', description: 'Switch the working tree to this branch. Git refuses if local changes would be overwritten.', repo: true }, record(row.data)); return;
    }
    if (view.kind === 'accounts') {
      const action: Action = { id: 'ssh-select', title: 'Change account and author', group: 'Accounts', command: 'ssh.select', description: 'Review current authentication and author before changing this repository’s account.', fields: [{ name: 'keepIdentity', label: 'Keep the current deliberate commit author', kind: 'boolean' }] };
      // Starts from the repository's current choice, so confirming without
      // touching it never undoes a deliberate author override.
      setForm({ action, fields: action.fields!, values: { keepIdentity: String(account?.keepIdentity === true) }, input: { profileId: row.id } }); setNavigation(initialNavigation()); return;
    }
    if (view.kind === 'files') {
      const entry = record(row.data); const file = String(entry['path']);
      if (entry['source'] === 'conflict') { await execute(actions.find((a) => a.id === 'conflict')!, { path: file }); return; }
      const data = record(await api('GET', '/api/git/diff/structured', { path: file, source: entry['source'] }));
      const diff = data['file'] as DiffFile | null;
      pushView({ title: `${file} · v selects lines · s stage / u unstage`, kind: 'diff', file, source: String(entry['source']), details: diff?.binary ? 'Binary file. Stage or unstage the entire file from Changes.' : undefined,
        rows: diff?.hunks.flatMap((hunk) => [{ id: hunk.id, label: hunk.header, data: { hunkId: hunk.id } }, ...hunk.lines.map((line) => ({ id: line.id, label: `${line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '} ${line.content}`, data: line }))]) ?? [] }); return;
    }
    if (view.kind === 'history' || view.kind === 'search-commits') {
      const hash = record(row.data)['hash'];
      const result = await api('GET', '/api/git/commit/details', { hash });
      pushView({ title: `Commit ${String(hash).slice(0, 12)}`, kind: 'commit-details', rows: resultRows(result), details: result }); return;
    }
    if (view.kind === 'worktrees' && record(row.data)['path']) { setRepo(String(record(row.data)['path'])); return; }
    if (view.kind === 'rebase-plan' && view.plan) {
      if (row.id === 'apply-plan') {
        await review({ id: 'start-rebase', title: 'Apply rebase plan', group: 'Integrate', path: '/api/git/rebase/start', method: 'POST', description: 'Replay commits according to this plan. Published commits will be rewritten.' }, { plan: view.plan }); return;
      }
      const item = view.plan.items.find((entry) => entry.oid === row.id)!;
      const choices = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'] as const;
      item.action = choices[(choices.indexOf(item.action) + 1) % choices.length]!;
      setView({ ...view, rows: planRows(view.plan) }); return;
    }
    pushView({ title: row.label, kind: 'detail', rows: resultRows(row.data), details: row.data });
  };
  const stageSelection = async (action: 'stage' | 'unstage'): Promise<void> => {
    const selected = navigation.selected.length ? navigation.selected : [navigation.index];
    if (view.kind === 'files') {
      const files = selected.map((index) => record(visibleRows[index]?.data)).filter((entry) => entry['source'] === (action === 'stage' ? 'working-tree' : 'index')).map((entry) => String(entry['path']));
      if (!files.length) throw new Error(`Select ${action === 'stage' ? 'unstaged' : 'staged'} files first.`);
      await api('POST', `/api/git/${action}`, { files }); await showFiles(false);
    } else if (view.kind === 'diff') {
      const rows = selected.map((index) => visibleRows[index]).filter((row): row is Row => Boolean(row));
      const hunkIds = rows.filter((row) => record(row.data)['hunkId']).map((row) => row.id);
      const lineIds = rows.filter((row) => ['addition', 'deletion'].includes(String(record(row.data)['kind']))).map((row) => row.id);
      if (!hunkIds.length && !lineIds.length) throw new Error('Select changed lines or a hunk header.');
      await api('POST', '/api/git/diff/apply-selection', { action, filePath: view.file, ...(hunkIds.length ? { hunkIds } : { lineIds }) });
      await showFiles(false);
    } else { setMessage('Stage/unstage is available in Changes and file diffs.'); return; }
    setNavigation(initialNavigation()); setMessage(`${action === 'stage' ? 'Staged' : 'Unstaged'} selected changes.`); await readContext();
  };

  const matches = paletteMatches(query);
  const visibleRows = filter ? view.rows.filter((row) => row.label.toLowerCase().includes(filter.toLowerCase())) : view.rows;
  const count = pending ? 2 : form ? form.fields.length + 1 : prompt === 'palette' ? matches.length : visibleRows.length;
  useInput((input, key) => {
    if (key.ctrl && input === 'c') { exit(); return; }
    const name = key.escape ? 'escape' : key.return ? 'enter' : key.tab ? (key.shift ? 'shift+tab' : 'tab') : key.downArrow ? 'down' : key.upArrow ? 'up' : key.leftArrow ? 'left' : key.rightArrow ? 'right' : key.pageDown ? 'pagedown' : key.pageUp ? 'pageup' : key.ctrl ? `ctrl+${input}` : input;
    if (prompt) {
      if (key.escape) { setPrompt(null); setQuery(''); return; }
      if (key.return) {
        if (prompt === 'search') { setFilter(query); setPrompt(null); setNavigation(initialNavigation()); }
        else {
          const action = matches[navigation.index];
          setPrompt(null); setQuery('');
          if (query === 'start-rebase' && view.plan) run(() => review({ id: 'start-rebase', title: 'Apply rebase plan', group: 'Integrate', path: '/api/git/rebase/start', method: 'POST', description: 'Replay commits according to the reviewed plan. Published commits will be rewritten.' }, { plan: view.plan }));
          else if (query === 'resolve' && view.kind === 'conflict') {
            const action: Action = { id: 'resolve', title: 'Resolve conflict', group: 'Integrate', path: '/api/git/conflict/resolve', method: 'POST', description: 'Write the resolved contents and stage this file. Review both versions first.', fields: [{ name: 'resolvedContent', label: 'Resolved file contents (Ctrl+e opens editor)', kind: 'multiline' }] };
            setForm({ action, fields: action.fields!, values: { resolvedContent: '' }, input: { filePath: view.file } }); setNavigation(initialNavigation());
          } else if (action) run(() => begin(action), true);
        }
        return;
      }
      if (key.upArrow || key.downArrow) { setNavigation((old) => ({ ...old, index: Math.max(0, Math.min(count - 1, old.index + (key.downArrow ? 1 : -1))) })); return; }
      if (key.backspace || key.delete) setQuery((old) => old.slice(0, -1));
      else if (!key.ctrl && !key.meta) { setQuery((old) => old + terminalText(input)); setNavigation(initialNavigation()); }
      return;
    }
    if (form && editing) {
      const entry = form.fields[navigation.index]!;
      if (key.escape || key.return && entry.kind !== 'multiline' && entry.kind !== 'list') { setEditing(false); return; }
      if (key.ctrl && input === 'e' && entry.kind !== 'secret') {
        run(async () => {
          const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-git-edit-'));
          const file = path.join(folder, 'message.txt');
          fs.writeFileSync(file, form.values[entry.name] ?? '', { mode: 0o600 });
          // The editor gets the whole terminal. Ink stops drawing and hands
          // input over, then restores both and redraws, even if it fails.
          const [command, ...editorArgs] = editorCommand();
          try {
            await suspendTerminal(async () => {
              await new Promise<void>((resolve, reject) => {
                const child = spawn(command!, [...editorArgs, file], { stdio: 'inherit', shell: false });
                child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('The editor exited with an error; the text was not changed.')));
              });
            });
            const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
            setForm((old) => old ? { ...old, values: { ...old.values, [entry.name]: text } } : old);
          } finally {
            fs.rmSync(folder, { recursive: true, force: true });
          }
        }); return;
      }
      if (key.ctrl || key.meta) return;
      const value = form.values[entry.name] ?? '';
      const next = key.backspace || key.delete ? value.slice(0, -1) : value + (key.return ? '\n' : terminalText(input));
      setForm({ ...form, values: { ...form.values, [entry.name]: next } }); return;
    }
    if (pending) {
      if (key.escape) { setPending(null); return; }
      if (name === 'j' || key.downArrow || name === 'k' || key.upArrow || key.tab) { setNavigation((old) => ({ ...old, index: 1 - old.index })); return; }
      if (key.return) {
        if (navigation.index === 0) { setPending(null); return; }
        const confirmed = ['pull', 'push', 'ssh-select', 'remote-toggle'].includes(pending.action.id) ? { confirmed: true } : {};
        const request = pending;
        if (!busy || request.action.id === 'operation-cancel') setPending(null);
        run(() => execute(request.action, { ...request.input, ...confirmed }), request.action.id === 'operation-cancel');
      }
      if (name === 'ctrl+d') setDetailOffset((old) => old + Math.floor(page / 2));
      if (name === 'ctrl+u') setDetailOffset((old) => Math.max(0, old - Math.floor(page / 2)));
      return;
    }
    if (form) {
      if (key.escape) { setForm(null); setEditing(false); return; }
      if (key.return) {
        if (navigation.index === form.fields.length) {
          run(async () => { await review(form.action, { ...form.input, ...parseFields(form.fields, form.values) }); }, true); return;
        }
        const entry = form.fields[navigation.index]!;
        if (entry.kind === 'boolean') setForm({ ...form, values: { ...form.values, [entry.name]: String(form.values[entry.name] !== 'true') } });
        else if (entry.choices) setForm({ ...form, values: { ...form.values, [entry.name]: entry.choices[(entry.choices.indexOf(form.values[entry.name]!) + 1) % entry.choices.length]! } });
        else setEditing(true);
        return;
      }
      const next = navigate(navigation, name, count, page, preferences.bindings); setNavigation(next.state); return;
    }
    if (view.kind === 'rebase-plan' && view.plan && (input === 'J' || input === 'K')) {
      const index = navigation.index; const target = index + (input === 'J' ? 1 : -1);
      if (index < view.plan.items.length && target >= 0 && target < view.plan.items.length) {
        const items = [...view.plan.items]; [items[index], items[target]] = [items[target]!, items[index]!];
        setView({ ...view, plan: { ...view.plan, items }, rows: planRows({ ...view.plan, items }) });
        setNavigation({ ...navigation, index: target });
      } return;
    }
    if (navigation.pane === 2 && ['j', 'k', 'ctrl+d', 'ctrl+u'].includes(name)) { setDetailOffset((old) => Math.max(0, old + (name === 'j' ? 1 : name === 'k' ? -1 : name === 'ctrl+d' ? page / 2 : -page / 2))); return; }
    if (navigation.pane === 1 && ['j', 'k', 'down', 'up'].includes(name)) { setGroupIndex((old) => Math.max(0, Math.min(groups.length - 1, old + (name === 'j' || name === 'down' ? 1 : -1)))); return; }
    if (navigation.pane === 1 && ['enter', 'l', 'right'].includes(name)) {
      pushView({ title: groups[groupIndex]!, kind: 'actions', rows: actions.filter((a) => a.group === groups[groupIndex]).map((a) => ({ id: a.id, label: a.title, action: a, data: a.description })) }); return;
    }
    const next = navigate(navigation, name, count, page, preferences.bindings); setNavigation(next.state);
    if (!next.action) return;
    if (next.action === 'palette' || next.action === 'search') { setPrompt(next.action); setQuery(''); setNavigation(initialNavigation()); return; }
    if (next.action === 'next-match' || next.action === 'previous-match') { setNavigation({ ...navigation, index: (navigation.index + (next.action === 'next-match' ? 1 : -1) + count) % Math.max(1, count) }); return; }
    if (next.action === 'back') {
      if (filter) { setFilter(''); return; }
      const previous = history.current.pop();
      if (previous) { setView(previous.view); setNavigation(previous.navigation); setFilter(previous.filter); setDetailOffset(previous.detailOffset); }
      else setMessage('Ctrl+c exits. Shared operations continue until complete.');
      return;
    }
    if (next.action === 'help') { pushView({ title: 'Keyboard help', kind: 'help', rows: [], details: 'j/k or arrows: move · h/l: back/open\ngg / G: first / last · Ctrl+d/u: half page\nCtrl+w then h/j/k/l: pane · Tab: cycle panes\n/ search · n/N next/previous · : command palette\nSpace: leader menu · v: select · s/u: stage/unstage\nEnter: open / edit field · Esc: return without submitting\nINPUT mode: keys type text, never invoke actions\nCtrl+e in a text field: open VISUAL/EDITOR\nCtrl+c: exit (does not undo remote effects)\n\n' + Object.entries(preferences.bindings).map(([keyName, action]) => `Space ${keyName}  ${action}`).join('\n') }); return; }
    if (next.action === 'open') { run(() => open(visibleRows[navigation.index]), true); return; }
    if (next.action === 'stage' || next.action === 'unstage') { run(() => stageSelection(next.action as 'stage' | 'unstage')); return; }
    if (next.action === 'refresh') { run(async () => { await readContext(); if (view.kind === 'operations') await begin(actions.find((a) => a.id === 'operations')!); else await showFiles(false); }, true); return; }
    const action = actions.find((entry) => entry.id === next.action);
    if (action) run(() => begin(action), true);
  });

  const mode = editing || prompt ? 'INPUT' : navigation.mode;
  const active = visibleRows[navigation.index];
  const reason = autoPullBlockedReason(status);
  const start = Math.max(0, navigation.index - page + 1);
  const displayRows = visibleRows.slice(start, start + page);
  const detailText = details(view.details ?? active?.data ?? 'No entries. Use : to find an action.').split('\n');
  const bodyWidth = Math.max(30, size.width - (size.width >= 110 ? 23 : 0));
  return <Box flexDirection="column" width={size.width} height={Math.max(20, size.height - 1)} paddingX={1}>
    <Box justifyContent="space-between"><Text bold color={color}>MULTI-GIT <Text dimColor>v{appVersion()}</Text></Text><Text color={color}>{busy ? 'WORKING' : mode}</Text></Box>
    <Text wrap="truncate">{repo ? path.basename(repo) : 'No repository'}  /  {status?.branch || (status?.detached ? 'detached HEAD' : '-')}  {glyph.up}{status?.ahead ?? 0} {glyph.down}{status?.behind ?? 0}{status?.tracking ? `  ${glyph.dot} ${status.tracking}` : repo ? `  ${glyph.dot} no upstream` : ''}</Text>
    <Text dimColor wrap="truncate">{repo || 'Open or clone a repository to begin.'}</Text>
    <Text wrap="truncate">Auto-pull: {!config?.settings.autoPull ? 'Off' : reason ? `Blocked ${glyph.dot} ${reason}` : 'Ready'}  {glyph.dot}  Account: {!repo ? '-' : account === null ? 'unknown' : config?.sshProfiles.find((profile) => profile.id === account.profileId)?.label ?? 'System SSH'}</Text>
    {pending ? <Box flexDirection="column" borderStyle={glyph.border} borderColor={color} flexGrow={1} paddingX={1}>
      <Text bold>{pending.action.title}</Text><Text>{pending.action.description}</Text>
      <Box flexDirection="column" height={Math.max(3, page - 3)} overflow="hidden"><Text>{details(pending.preview).split('\n').slice(detailOffset, detailOffset + page - 3).join('\n')}</Text></Box>
      <Text color={navigation.index === 0 ? color : undefined}>{navigation.index === 0 ? marker : ' '} Back — do not change anything</Text>
      <Text color={navigation.index === 1 ? color : undefined}>{navigation.index === 1 ? marker : ' '} Confirm {pending.action.title}</Text>
      <Text dimColor>j/k select · Enter activate · Ctrl+d/u scroll preview · Esc cancel</Text>
    </Box> : form ? <Box flexDirection="column" borderStyle={glyph.border} borderColor={color} flexGrow={1} paddingX={1}>
      <Text bold>{form.action.title}</Text><Text dimColor>{form.action.description}</Text>
      {form.fields.map((entry, index) => <Text key={entry.name} color={navigation.index === index ? color : undefined} wrap="truncate">{navigation.index === index ? marker : ' '} {entry.label}: {entry.kind === 'secret' ? '*'.repeat(Math.min(32, (form.values[entry.name] ?? '').length)) : (form.values[entry.name] || '(empty)').replaceAll('\n', glyph.newline)}{editing && navigation.index === index ? ` ${glyph.cursor}` : ''}</Text>)}
      <Text bold color={navigation.index === form.fields.length ? color : undefined}>{navigation.index === form.fields.length ? marker : ' '} {form.action.method === 'GET' ? 'Show results' : 'Review changes'}</Text>
      <Text dimColor>{editing ? 'Type value · Esc finishes editing without submitting · Ctrl+e editor' : 'j/k move · Enter edit/toggle · select Review to continue · Esc back'}</Text>
    </Box> : prompt ? <Box flexDirection="column" borderStyle={glyph.border} borderColor={color} flexGrow={1} paddingX={1}>
      <Text bold>{prompt === 'palette' ? ':' : '/'}{query}{glyph.cursor}</Text>
      <Text dimColor>{prompt === 'palette' ? 'Find an action by name or intent · arrows select · Enter opens' : 'Search this view · Enter applies · Esc cancels'}</Text>
      {prompt === 'palette' && matches.slice(Math.max(0, navigation.index - page + 2), Math.max(0, navigation.index - page + 2) + page - 1).map((action) => <Text key={action.id} color={matches[navigation.index]?.id === action.id ? color : undefined} wrap="truncate">{matches[navigation.index]?.id === action.id ? marker : ' '} {action.title}{action.repo && !repo ? ' — open a repository first' : ''}</Text>)}
    </Box> : navigation.prefix === 'leader' ? <Box flexDirection="column" flexGrow={1} borderStyle={glyph.border} borderColor={color} paddingX={1}>
      <Text bold>Actions · press a shown key · Esc cancels</Text>
      {Object.entries(preferences.bindings).map(([binding, id]) => <Text key={binding}>{binding.padEnd(3)} {actions.find((action) => action.id === id)?.title ?? id}</Text>)}
    </Box> : <Box flexGrow={1}>
      {(size.width >= 110 || navigation.pane === 1) && <Box flexDirection="column" width={size.width >= 110 ? 22 : bodyWidth - 2} borderStyle={glyph.frame} borderColor={navigation.pane === 1 ? color : undefined} paddingX={1}>
        <Text bold>WORKFLOWS</Text>{groups.slice(Math.max(0, groupIndex - page + 2), Math.max(0, groupIndex - page + 2) + page - 1).map((group) => <Text key={group} color={groups[groupIndex] === group ? color : undefined}>{groups[groupIndex] === group ? marker : ' '} {group}</Text>)}
      </Box>}
      {(size.width >= 110 || navigation.pane !== 1) && <Box flexDirection="column" width={size.width >= 145 ? Math.floor(bodyWidth * .55) : bodyWidth - 2} borderStyle={glyph.frame} borderColor={navigation.pane === 0 ? color : undefined} paddingX={1}>
        <Text bold wrap="truncate">{view.title}{filter ? ` /${filter}` : ''}</Text>
        {(size.width >= 145 || navigation.pane !== 2) && displayRows.map((row, index) => <Text key={row.id} color={start + index === navigation.index ? color : undefined} wrap="truncate">{navigation.selected.includes(start + index) ? '*' : start + index === navigation.index ? marker : ' '} {terminalText(row.label)}</Text>)}
        {(!displayRows.length || size.width < 145 && navigation.pane === 2) && <Box height={page} overflow="hidden"><Text>{detailText.slice(detailOffset, detailOffset + page).join('\n')}</Text></Box>}
      </Box>}
      {size.width >= 145 && <Box width={bodyWidth - Math.floor(bodyWidth * .55) - 2} flexDirection="column" borderStyle={glyph.frame} borderColor={navigation.pane === 2 ? color : undefined} paddingX={1}><Text bold>DETAILS</Text><Text>{detailText.slice(detailOffset, detailOffset + page).join('\n')}</Text></Box>}
    </Box>}
    {size.width < 145 && <Text dimColor wrap="truncate">Tab: {['Changes / results', 'Workflows', 'Details'][navigation.pane]} · Shift+Tab goes back</Text>}
    <Text wrap="truncate" color={color}>{terminalText(message)}</Text>
    <Text dimColor wrap="truncate">Space actions · : commands · / search · j/k move · Enter open · ? help · Ctrl+c exit{navigation.mode === 'SELECT' ? ` · ${navigation.selected.length} selected` : ''}</Text>
  </Box>;
}

export async function runTerminal(args: string[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The terminal UI needs an interactive terminal. Use multi-git help for JSON commands.');
  let repo = ''; let origin = process.env['MULTI_GIT_URL'];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--repo' && args[index + 1]) repo = path.resolve(args[++index]!);
    else if (args[index] === '--server' && args[index + 1]) origin = serverOrigin(args[++index]!);
    else throw new Error(`Unknown terminal option: ${args[index]}`);
  }
  const connection: BackendConnection = origin ? { origin, close: async () => {}, call: async () => { throw new Error('This action requires the managed local backend. Start without --server.'); } } : await connectBackend();
  try {
    // Interactive whatever CI detection says: both ends are known to be a
    // terminal by now. The alternate screen gives the terminal back as it was.
    const instance = render(<Terminal connection={connection} initialRepo={repo} />, {
      exitOnCtrlC: false,
      stdout: asciiAwareOutput(process.stdout),
      interactive: true,
      alternateScreen: true
    });
    await instance.waitUntilExit();
  } finally { await connection.close(); }
}

/**
 * Whether everything written goes out as plain ASCII. Set from the ASCII-only
 * preference, and on by default where the terminal says it is dumb.
 */
let asciiOutput = process.env['TERM'] === 'dumb';

export function setAsciiOutput(enabled: boolean): void {
  asciiOutput = enabled || process.env['TERM'] === 'dumb';
}

/**
 * The terminal, with every frame passed through asciiOnly while ASCII output is
 * on. Done at the stream rather than per string, so no label, border or
 * message added later can slip a character past it.
 */
export function asciiAwareOutput(stream: NodeJS.WriteStream): NodeJS.WriteStream {
  return new Proxy(stream, {
    get(target, property) {
      if (property === 'write') {
        return (chunk: unknown, ...rest: unknown[]) =>
          (target.write as (...args: unknown[]) => boolean)(asciiOutput && typeof chunk === 'string' ? asciiOnly(chunk) : chunk, ...rest);
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
}
