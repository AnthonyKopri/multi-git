import { api, errorMessage } from '../../api/client';
import type { HostedRepository, RepositoryBrowserResponse } from '../../../shared/repository-browser-types';

let checkAvailability: () => Promise<void> = async () => {};
export function refreshCloneBrowserAvailability(): Promise<void> { return checkAvailability(); }

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
  let checkGeneration = 0;
  checkAvailability = async () => {
    const current = ++checkGeneration;
    check.disabled = true;
    try {
      const data = await api.get<{ available: boolean; authenticated: boolean }>('/api/github/cli-status', {
        repoScoped: false, query: { refresh: '1' }
      });
      if (current !== checkGeneration) return;
      install.classList.toggle('hidden', data.available);
      ghStatus.textContent = !data.available
        ? 'GitHub CLI is not installed. Paste a URL to clone now, or install it to enable browsing.'
        : !data.authenticated
          ? 'GitHub CLI is installed. Run gh auth login to enable browsing, then Check again. Pasting a URL still works.'
          : 'GitHub CLI is ready. Expand Browse GitHub repositories to choose a repository.';
    } catch {
      if (current === checkGeneration) ghStatus.textContent = 'Could not check GitHub CLI. You can still clone by pasting a URL.';
    } finally {
      if (current === checkGeneration) check.disabled = false;
    }
  };
  check.addEventListener('click', () => void checkAvailability());
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
