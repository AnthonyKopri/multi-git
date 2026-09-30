// @vitest-environment happy-dom
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expectedCloneBytes,
  initRepositoryBrowser,
  openCloneBrowser,
  refreshCloneBrowserAvailability
} from '../src/renderer/features/repo/browser';
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
  /** Answers each endpoint the panel talks to, so one mock can serve a whole flow. */
  function serve(cli: { available: boolean; authenticated: boolean } | Error) {
    return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url === '/api/github/cli-status') {
        if (cli instanceof Error) throw cli;
        return cli;
      }
      return { repositories: [repo], atLimit: false };
    });
  }
  const infoBoxHidden = () => element('clone-browser-info').classList.contains('hidden');
  const browser = () => element<HTMLDetailsElement>('clone-browser');

  it('shows the note about the GitHub CLI only while it is not installed', async () => {
    const get = serve({ available: false, authenticated: false });
    await refreshCloneBrowserAvailability();
    expect(infoBoxHidden()).toBe(false);

    get.mockImplementation(async () => ({ available: true, authenticated: false }));
    await refreshCloneBrowserAvailability();
    expect(infoBoxHidden()).toBe(true);

    get.mockImplementation(async () => ({ available: true, authenticated: true }));
    await refreshCloneBrowserAvailability();
    expect(infoBoxHidden()).toBe(true);
  });

  it('keeps the note when the check itself failed, since that proves nothing about the CLI', async () => {
    serve(new Error('offline'));
    await refreshCloneBrowserAvailability();

    expect(infoBoxHidden()).toBe(false);
    expect(element('clone-gh-status').textContent).toContain('Could not check GitHub CLI');
  });

  it('brings the note back if the CLI goes away between checks', async () => {
    const get = serve({ available: true, authenticated: true });
    await refreshCloneBrowserAvailability();
    expect(infoBoxHidden()).toBe(true);

    get.mockImplementation(async () => ({ available: false, authenticated: false }));
    await refreshCloneBrowserAvailability();
    expect(infoBoxHidden()).toBe(false);
  });

  it('opens the browser and loads your own repositories when the CLI is ready', async () => {
    const get = serve({ available: true, authenticated: true });
    expect(browser().open).toBe(false);

    await openCloneBrowser();
    await vi.waitFor(() => expect(document.querySelector('.clone-repository')).not.toBeNull());

    expect(browser().open).toBe(true);
    // No owner typed, so gh lists the signed-in user's repositories.
    expect(get).toHaveBeenCalledWith(
      '/api/github/repositories',
      expect.objectContaining({ query: { owner: '' } })
    );
    expect(element('clone-browser-status').textContent).toContain('1 matching repositories of 1 loaded');
  });

  it('loads for the owner already typed, the way pressing Load repositories would', async () => {
    const get = serve({ available: true, authenticated: true });
    element<HTMLInputElement>('clone-owner').value = 'my-org';

    await openCloneBrowser();

    await vi.waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/github/repositories',
        expect.objectContaining({ query: { owner: 'my-org' } })
      )
    );
  });

  it('does not open or load anything when the CLI is missing', async () => {
    const get = serve({ available: false, authenticated: false });

    await openCloneBrowser();

    expect(browser().open).toBe(false);
    expect(get).not.toHaveBeenCalledWith('/api/github/repositories', expect.anything());
  });

  it('does not open or load anything when the CLI is not signed in, and says what to do instead', async () => {
    const get = serve({ available: true, authenticated: false });

    await openCloneBrowser();

    expect(browser().open).toBe(false);
    expect(get).not.toHaveBeenCalledWith('/api/github/repositories', expect.anything());
    // The note is gone, so this line is where the user learns why.
    expect(infoBoxHidden()).toBe(true);
    expect(element('clone-browser-status').textContent).toContain('gh auth login');
    expect(element<HTMLButtonElement>('clone-load-repositories').disabled).toBe(false);
  });

  it('does not open or load anything when the check fails', async () => {
    const get = serve(new Error('offline'));

    await openCloneBrowser();

    expect(browser().open).toBe(false);
    expect(get).not.toHaveBeenCalledWith('/api/github/repositories', expect.anything());
  });

  it('leaves what the user typed alone when it loads', async () => {
    serve({ available: true, authenticated: true });
    element<HTMLInputElement>('clone-url').value = 'https://example.com/team/repo.git';

    await openCloneBrowser();
    await vi.waitFor(() => expect(document.querySelector('.clone-repository')).not.toBeNull());

    expect(element<HTMLInputElement>('clone-url').value).toBe('https://example.com/team/repo.git');
  });

  it('does not start a second load while one is already running', async () => {
    let finish!: (value: unknown) => void;
    const get = vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/github/cli-status') return Promise.resolve({ available: true, authenticated: true });
      return new Promise((resolve) => { finish = resolve; });
    });

    await openCloneBrowser();
    await openCloneBrowser();

    expect(get.mock.calls.filter(([url]) => url === '/api/github/repositories')).toHaveLength(1);
    finish({ repositories: [repo], atLimit: false });
  });

  it('browses as soon as Check again finds the CLI, which is what the user installed it for', async () => {
    const get = serve({ available: false, authenticated: false });
    await refreshCloneBrowserAvailability();
    expect(browser().open).toBe(false);

    get.mockImplementation(async (url: string) =>
      url === '/api/github/cli-status'
        ? { available: true, authenticated: true }
        : { repositories: [repo], atLimit: false }
    );
    element('clone-check-gh').click();

    await vi.waitFor(() => expect(document.querySelector('.clone-repository')).not.toBeNull());
    expect(browser().open).toBe(true);
    expect(infoBoxHidden()).toBe(true);
  });

  describe('the expected download size', () => {
    const sized = { ...repo, diskUsage: 38345 };

    async function load(repositories: unknown[]) {
      vi.spyOn(api, 'get').mockResolvedValue({ repositories, atLimit: false });
      element('clone-load-repositories').click();
      await vi.waitFor(() => expect(document.querySelector('.clone-repository')).not.toBeNull());
    }

    it('is GitHub\'s size for a repository that was loaded, in bytes', async () => {
      await load([sized]);

      expect(expectedCloneBytes(sized.sshUrl)).toBe(38345 * 1024);
      expect(expectedCloneBytes(`${sized.url}.git`)).toBe(38345 * 1024);
      expect(expectedCloneBytes(sized.url)).toBe(38345 * 1024);
    });

    it('matches however the URL was typed', async () => {
      await load([sized]);

      expect(expectedCloneBytes(`  ${sized.url.toUpperCase()}.git/  `)).toBe(38345 * 1024);
    });

    it('is nothing for a URL that is not one of them, since it may be another repository', async () => {
      await load([sized]);

      expect(expectedCloneBytes('https://github.com/team/other.git')).toBeUndefined();
      expect(expectedCloneBytes('')).toBeUndefined();
    });

    it('is nothing when GitHub gave no size, or a size of nothing', async () => {
      await load([repo, { ...repo, url: 'https://github.com/team/empty', sshUrl: 'git@github.com:team/empty.git', diskUsage: 0 }]);

      expect(expectedCloneBytes(repo.sshUrl)).toBeUndefined();
      expect(expectedCloneBytes('git@github.com:team/empty.git')).toBeUndefined();
    });

    it('is forgotten when the list is cleared for another owner', async () => {
      await load([sized]);
      element('clone-owner').dispatchEvent(new Event('input'));

      expect(expectedCloneBytes(sized.sshUrl)).toBeUndefined();
    });
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
