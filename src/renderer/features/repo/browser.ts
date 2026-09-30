import { api, errorMessage } from '../../api/client';
import type { HostedRepository, RepositoryBrowserResponse } from '../../../shared/repository-browser-types';

/**
 * What the GitHub CLI check found. `unknown` is a check that itself failed,
 * which says nothing about whether `gh` is there.
 */
export type GithubCliState = 'ready' | 'signed-out' | 'missing' | 'unknown';

let checkAvailability: () => Promise<GithubCliState | null> = async () => null;
let browseWhenReady: () => Promise<void> = async () => {};
let sizeLookup: (url: string) => number | undefined = () => undefined;
export function refreshCloneBrowserAvailability(): Promise<GithubCliState | null> { return checkAvailability(); }

/**
 * Called when the clone dialog opens: looks for the GitHub CLI and, when it is
 * installed and signed in, expands the browser and loads the user's own
 * repositories, so nothing has to be opened or pressed to see them.
 */
export function openCloneBrowser(): Promise<void> { return browseWhenReady(); }

/**
 * How many bytes cloning this URL should download, when it is one of the loaded
 * repositories and GitHub gave its size. Undefined for a pasted URL, which is
 * then estimated from the object count instead.
 */
export function expectedCloneBytes(url: string): number | undefined { return sizeLookup(url); }

export function initRepositoryBrowser(): void {
  const owner = document.querySelector<HTMLInputElement>('#clone-owner')!;
  const filter = document.querySelector<HTMLInputElement>('#clone-repository-filter')!;
  const protocol = document.querySelector<HTMLSelectElement>('#clone-protocol')!;
  const load = document.querySelector<HTMLButtonElement>('#clone-load-repositories')!;
  const results = document.querySelector<HTMLElement>('#clone-repository-results')!;
  const status = document.querySelector<HTMLElement>('#clone-browser-status')!;
  const url = document.querySelector<HTMLInputElement>('#clone-url')!;
  const ghStatus = document.querySelector<HTMLElement>('#clone-gh-status')!;
  const install = document.querySelector<HTMLAnchorElement>('#clone-install-gh')!;
  const check = document.querySelector<HTMLButtonElement>('#clone-check-gh')!;
  const info = document.querySelector<HTMLElement>('#clone-browser-info')!;
  const browser = document.querySelector<HTMLDetailsElement>('#clone-browser')!;
  let checkGeneration = 0;
  checkAvailability = async () => {
    const current = ++checkGeneration;
    check.disabled = true;
    try {
      const data = await api.get<{ available: boolean; authenticated: boolean }>('/api/github/cli-status', {
        repoScoped: false, query: { refresh: '1' }
      });
      if (current !== checkGeneration) return null;
      install.classList.toggle('hidden', data.available);
      // The note is there to say what is missing. With the CLI installed there
      // is nothing left to say that the list itself does not, so it goes.
      info.classList.toggle('hidden', data.available);
      ghStatus.textContent = !data.available
        ? 'GitHub CLI is not installed. Paste a URL to clone now, or install it to enable browsing.'
        : !data.authenticated
          ? 'GitHub CLI is installed. Run gh auth login to enable browsing, then Check again. Pasting a URL still works.'
          : 'GitHub CLI is ready. Load repositories, then pick one to fill in the URL.';
      if (data.available && !data.authenticated) {
        // With the note gone this line is where a signed-out user is told why
        // there is no list, and Load repositories is what they press afterwards.
        status.textContent = 'GitHub CLI is not signed in. Run gh auth login in a terminal, then press Load repositories. Pasting a URL still works.';
      }
      return !data.available ? 'missing' : data.authenticated ? 'ready' : 'signed-out';
    } catch {
      if (current === checkGeneration) {
        // A failed check is not evidence the CLI is installed, so the note stays.
        info.classList.remove('hidden');
        ghStatus.textContent = 'Could not check GitHub CLI. You can still clone by pasting a URL.';
        return 'unknown';
      }
      return null;
    } finally {
      if (current === checkGeneration) check.disabled = false;
    }
  };
  browseWhenReady = async () => {
    if ((await checkAvailability()) !== 'ready') return;
    browser.open = true;
    // The button rather than the request behind it, so this is exactly what
    // pressing it would do, including ignoring a load that is already running.
    load.click();
  };
  check.addEventListener('click', () => void browseWhenReady());
  install.addEventListener('click', async (event) => {
    if (!window.desktopApi?.installPrerequisite) return; // Browser mode uses the official download link.
    event.preventDefault();
    if (install.getAttribute('aria-disabled') === 'true') return;
    install.setAttribute('aria-disabled', 'true');
    try {
      const outcome = await window.desktopApi.installPrerequisite('gh');
      ghStatus.textContent = outcome.started
        ? 'GitHub CLI installation started in a terminal. When it finishes, run gh auth login and press Check again.'
        : 'Opened the GitHub CLI download page. Install it, run gh auth login, then press Check again.';
    } catch (error) {
      ghStatus.textContent = `${errorMessage(error)} You can still clone by pasting a URL.`;
    } finally { install.removeAttribute('aria-disabled'); }
  });
  let repositories: HostedRepository[] = [];
  let generation = 0;
  let atLimit = false;
  // Compared without a trailing ".git" or slash, so the URL as picked and as
  // typed by hand match. A URL edited into something else stops matching, and
  // so loses the size, which is right: it may be a different repository.
  const canonical = (value: string): string => value.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  sizeLookup = (cloneUrl) => {
    const wanted = canonical(cloneUrl);
    const match = repositories.find((repo) => canonical(repo.url) === wanted || canonical(repo.sshUrl) === wanted);
    return match?.diskUsage !== undefined && match.diskUsage > 0 ? match.diskUsage * 1024 : undefined;
  };

  function render(): void {
    const query = filter.value.trim().toLowerCase();
    const matches = repositories.filter((repo) => `${repo.nameWithOwner} ${repo.description}`.toLowerCase().includes(query));
    results.replaceChildren();
    for (const repo of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary clone-repository';
      button.textContent = `${repo.nameWithOwner} · ${repo.isPrivate ? 'Private' : 'Public'}${repo.isArchived ? ' · Archived' : ''}`;
      button.title = repo.description || repo.nameWithOwner;
      button.addEventListener('click', () => {
        url.value = protocol.value === 'https' ? `${repo.url}.git` : repo.sshUrl;
        url.dispatchEvent(new Event('input', { bubbles: true }));
        status.textContent = `Selected ${repo.nameWithOwner}. Review the URL, destination and SSH profile, then Clone.`;
        url.focus();
      });
      results.appendChild(button);
    }
    status.textContent = `${matches.length} matching repositories of ${repositories.length} loaded.${atLimit ? ' Limit of 100 reached; paste a URL if your repository is missing.' : ''}`;
  }

  owner.addEventListener('input', () => {
    generation++;
    repositories = [];
    results.replaceChildren();
    status.textContent = 'Load repositories for this owner.';
    load.disabled = false;
  });
  filter.addEventListener('input', render);
  // These controls live in the clone form, but Enter here means browse/filter,
  // not submit a previously filled clone request.
  for (const input of [owner, filter]) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (input === owner) load.click();
    });
  }
  load.addEventListener('click', async () => {
    const current = ++generation;
    load.disabled = true;
    repositories = [];
    results.replaceChildren();
    status.textContent = 'Loading GitHub repositories…';
    try {
      const data = await api.get<RepositoryBrowserResponse>('/api/github/repositories', {
        repoScoped: false, query: { owner: owner.value.trim() }
      });
      if (current !== generation) return;
      repositories = data.repositories;
      atLimit = data.atLimit;
      render();
    } catch (error) {
      if (current === generation) status.textContent = `${errorMessage(error)} You can still paste a repository URL.`;
    } finally {
      if (current === generation) load.disabled = false;
    }
  });
}
