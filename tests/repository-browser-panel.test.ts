// @vitest-environment happy-dom
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initRepositoryBrowser, refreshCloneBrowserAvailability } from '../src/renderer/features/repo/browser';
import { api } from '../src/renderer/api/client';

const repo = { nameWithOwner: 'team/repo', description: '<img src=x>', url: 'https://github.com/team/repo', sshUrl: 'git@github.com:team/repo.git', isPrivate: true, isArchived: false };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = fs.readFileSync('public/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '');
  initRepositoryBrowser();
});
describe('clone repository browser', () => {
  it('uses Enter in owner to browse without submitting a previously filled clone form', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ repositories: [], atLimit: false });
    const submit = vi.fn();
    element('clone-form').addEventListener('submit', submit);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    element('clone-owner').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(get).toHaveBeenCalledWith('/api/github/repositories', expect.anything());
    expect(submit).not.toHaveBeenCalled();
    const filterEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    element('clone-repository-filter').dispatchEvent(filterEnter);
    expect(filterEnter.defaultPrevented).toBe(true);
  });
  it('offers installation without hiding or changing the old paste workflow', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ available: false, authenticated: false });
    element<HTMLInputElement>('clone-url').value = 'https://example.com/team/repo.git';
    await refreshCloneBrowserAvailability();
    expect(element('clone-gh-status').textContent).toContain('Paste a URL to clone now');
    expect(element('clone-install-gh').classList.contains('hidden')).toBe(false);
    expect(element<HTMLAnchorElement>('clone-install-gh').href).toBe('https://cli.github.com/');
    expect(element<HTMLInputElement>('clone-url').value).toBe('https://example.com/team/repo.git');
    expect(element<HTMLInputElement>('clone-url').disabled).toBe(false);
    expect(element<HTMLButtonElement>('btn-start-clone').disabled).toBe(false);
  });
  it('uses the desktop installer only on explicit click and updates after recheck', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ available: false, authenticated: false });
    const install = vi.fn().mockResolvedValue({ started: true, via: 'winget' });
    const previous = window.desktopApi;
    window.desktopApi = { installPrerequisite: install } as unknown as NonNullable<typeof window.desktopApi>;
    try {
      await refreshCloneBrowserAvailability();
      expect(install).not.toHaveBeenCalled();
      element('clone-install-gh').click();
      await vi.waitFor(() => expect(install).toHaveBeenCalledWith('gh'));
      get.mockResolvedValue({ available: true, authenticated: false });
      await refreshCloneBrowserAvailability();
      expect(element('clone-install-gh').classList.contains('hidden')).toBe(true);
      expect(element('clone-gh-status').textContent).toContain('gh auth login');
      get.mockResolvedValue({ available: true, authenticated: true });
      await refreshCloneBrowserAvailability();
      expect(element('clone-gh-status').textContent).toContain('ready');
    } finally { window.desktopApi = previous; }
  });
  it('filters safely and selects either protocol without cloning', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ repositories: [repo], atLimit: false });
    element('clone-load-repositories').click();
    await vi.waitFor(() => expect(document.querySelector('.clone-repository')).not.toBeNull());
    expect(element('clone-repository-results').querySelector('img')).toBeNull();
    (document.querySelector('.clone-repository') as HTMLButtonElement).click();
    expect(element<HTMLInputElement>('clone-url').value).toBe(repo.sshUrl);
    element<HTMLSelectElement>('clone-protocol').value = 'https';
    (document.querySelector('.clone-repository') as HTMLButtonElement).click();
    expect(element<HTMLInputElement>('clone-url').value).toBe(`${repo.url}.git`);
    element<HTMLInputElement>('clone-repository-filter').value = 'missing';
    element('clone-repository-filter').dispatchEvent(new Event('input'));
    expect(element('clone-repository-results').children).toHaveLength(0);
  });
  it('ignores a response for an owner edited while loading', async () => {
    let resolve!: (value: unknown) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((r) => { resolve = r; }));
    element('clone-load-repositories').click();
    element('clone-owner').dispatchEvent(new Event('input'));
    resolve({ repositories: [repo], atLimit: false });
    await Promise.resolve();
    expect(element('clone-repository-results').children).toHaveLength(0);
  });
  it('keeps manual entry usable when gh fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Sign in with gh auth login'));
    element('clone-load-repositories').click();
    await vi.waitFor(() => expect(element('clone-browser-status').textContent).toContain('paste a repository URL'));
    expect(element<HTMLButtonElement>('clone-load-repositories').disabled).toBe(false);
  });
});
