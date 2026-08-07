// @vitest-environment happy-dom
//
// The pull-request creator, driven through its real markup.
//
// The markup comes from public/index.html rather than a hand-written fixture,
// so a renamed id or a removed field fails here rather than only in the app.
// The API module is stubbed: this is about what the window does with an
// answer, not about reaching a server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';
import type { PullRequestPreflight } from '../src/shared/pull-request-types';

/** A preflight with everything green, which each test then bends. */
function preflight(overrides: Partial<PullRequestPreflight> = {}): PullRequestPreflight {
  return {
    provider: 'github',
    authenticated: true,
    cliAvailable: true,
    headBranch: 'feat/thing',
    headPushed: true,
    defaultBaseBranch: 'main',
    branches: ['main', 'feat/thing', 'other'],
    commitsAhead: 2,
    commitsBehind: 0,
    targetRepo: 'octocat/demo',
    isDetachedHead: false,
    hasUncommittedChanges: false,
    commitSubjects: ['feat: first', 'feat: second'],
    changedFileCount: 3,
    suggestedTitle: 'Suggested title',
    suggestedBody: 'Suggested body',
    warnings: [],
    ...overrides
  };
}

const endpoints = vi.hoisted(() => ({
  preflightPullRequest: vi.fn(),
  createPullRequest: vi.fn()
}));

vi.mock('../src/renderer/api/endpoints', () => endpoints);
vi.mock('../src/renderer/ui/toast', () => ({ showToast: vi.fn(), initToasts: vi.fn() }));
vi.mock('../src/renderer/ui/log', () => ({ logToTerminal: vi.fn() }));
vi.mock('../src/renderer/state/store', () => ({
  getState: () => ({ activeRepo: '/repo', activeProfileId: 'p1' })
}));
vi.mock('../src/renderer/ui/busy', () => ({
  // Run the body directly: the busy wrapper is not what these test.
  withButtonBusy: (_button: unknown, body: () => Promise<void>) => body()
}));

/** The page's markup, with its script tags removed. */
function pageMarkup(): string {
  const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';

  // The bundle is loaded here by importing the module directly. Leaving the
  // tag in makes happy-dom try to fetch app.js over HTTP and log a failure per
  // mount, which buries anything worth reading.
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/** Loads index.html into the document and initialises the window. */
async function mount() {
  document.body.innerHTML = pageMarkup();

  vi.resetModules();
  const { resolveElements } = await import('../src/renderer/dom/elements');
  const feature = await import('../src/renderer/features/pull-request');

  const ui = resolveElements();
  feature.initPullRequests(ui, { refreshStatus: async () => {} });

  return { ui, feature };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

beforeEach(() => {
  endpoints.preflightPullRequest.mockReset();
  endpoints.createPullRequest.mockReset();
  endpoints.preflightPullRequest.mockResolvedValue({ success: true, preflight: preflight() });
  endpoints.createPullRequest.mockResolvedValue({
    success: true,
    pullRequest: { provider: 'github', number: 42, url: 'https://example.test/pr/42', state: 'open' }
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('opening the window', () => {
  it('fills the form from preflight', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    expect($('pr-modal').classList.contains('hidden')).toBe(false);
    expect(($('pr-title') as HTMLInputElement).value).toBe('Suggested title');
    expect(($('pr-body') as HTMLTextAreaElement).value).toBe('Suggested body');
    expect($('pr-target-summary').textContent).toContain('octocat/demo');
    expect($('pr-target-summary').textContent).toContain('3 file(s) changed');
  });

  it('offers every local branch on both selectors', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    const base = $('pr-base-branch') as HTMLSelectElement;
    const head = $('pr-head-branch') as HTMLSelectElement;

    expect([...base.options].map((option) => option.value)).toEqual(['main', 'feat/thing', 'other']);
    expect(base.value).toBe('main');
    expect(head.value).toBe('feat/thing');
  });

  it('lists the commits that would be included', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    expect($('pr-commit-summary').textContent).toContain('2 commit(s)');
    expect($('pr-commit-summary').textContent).toContain('feat: first');
  });

  it('renders a branch name as text, never as markup', async () => {
    // A repository is not trusted input; a branch name is repository data.
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ branches: ['<img src=x onerror=alert(1)>'], headBranch: 'main' })
    });

    const { feature } = await mount();
    await feature.openCreator();

    expect(document.querySelector('#pr-base-branch img')).toBeNull();
    expect(($('pr-base-branch') as HTMLSelectElement).options[0]?.textContent).toContain('<img');
  });
});

describe('warnings and blocking', () => {
  it('shows warnings as a list', async () => {
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ warnings: ['first problem', 'second problem'] })
    });

    const { feature } = await mount();
    await feature.openCreator();

    expect($('pr-warnings').classList.contains('hidden')).toBe(false);
    expect($('pr-warnings').querySelectorAll('li')).toHaveLength(2);
    expect($('pr-warnings').textContent).toContain('first problem');
  });

  it('disables Create when there is nothing to merge', async () => {
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ commitsAhead: 0 })
    });

    const { feature } = await mount();
    await feature.openCreator();

    expect(($('btn-pr-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Create when gh is missing or signed out', async () => {
    for (const bad of [{ cliAvailable: false }, { authenticated: false }]) {
      endpoints.preflightPullRequest.mockResolvedValue({
        success: true,
        preflight: preflight(bad)
      });

      const { feature } = await mount();
      await feature.openCreator();

      expect(($('btn-pr-create') as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('disables Create when a pull request already exists', async () => {
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ existingPullRequestUrl: 'https://example.test/pr/1' })
    });

    const { feature } = await mount();
    await feature.openCreator();

    expect(($('btn-pr-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says "Push and create" when the branch is unpushed', async () => {
    // The label has to describe what pressing it will actually do.
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ headPushed: false })
    });

    const { feature } = await mount();
    await feature.openCreator();

    expect($('btn-pr-create').textContent).toBe('Push and create');
  });
});

describe('preserving what the user typed', () => {
  it('does not overwrite an edited title when preflight runs again', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    const title = $('pr-title') as HTMLInputElement;
    title.value = 'My own title';
    title.dispatchEvent(new Event('input'));

    const body = $('pr-body') as HTMLTextAreaElement;
    body.value = 'My own body';
    body.dispatchEvent(new Event('input'));

    // Changing the base re-runs preflight for the new commit range.
    $('pr-base-branch').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(endpoints.preflightPullRequest).toHaveBeenCalledTimes(2));

    expect(title.value).toBe('My own title');
    expect(body.value).toBe('My own body');
  });

  it('still seeds a field the user has not touched', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    const title = $('pr-title') as HTMLInputElement;
    title.value = 'Edited';
    title.dispatchEvent(new Event('input'));

    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ suggestedBody: 'A newer body' })
    });
    $('pr-base-branch').dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(($('pr-body') as HTMLTextAreaElement).value).toBe('A newer body')
    );

    expect(title.value).toBe('Edited');
  });

  it('starts fresh the next time the window opens', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    const title = $('pr-title') as HTMLInputElement;
    title.value = 'Edited';
    title.dispatchEvent(new Event('input'));

    await feature.openCreator();

    expect(($('pr-title') as HTMLInputElement).value).toBe('Suggested title');
  });
});

describe('submitting', () => {
  async function submit() {
    $('pr-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(endpoints.createPullRequest).toHaveBeenCalled());
  }

  it('refuses an empty title and focuses it', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    const title = $('pr-title') as HTMLInputElement;
    title.value = '   ';
    title.dispatchEvent(new Event('input'));

    $('pr-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect($('pr-feedback').textContent).toContain('title is required'));

    expect(endpoints.createPullRequest).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('pr-title');
  });

  it('sends the form contents, including the toggles', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    ($('pr-draft') as HTMLInputElement).checked = true;
    ($('pr-maintainer-edit') as HTMLInputElement).checked = false;
    ($('pr-reviewers') as HTMLInputElement).value = 'octocat, hubot';
    ($('pr-labels') as HTMLInputElement).value = ' bug , ';

    await submit();

    expect(endpoints.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: 'main',
        headBranch: 'feat/thing',
        title: 'Suggested title',
        draft: true,
        maintainerCanModify: false,
        reviewers: ['octocat', 'hubot'],
        // Blank entries dropped rather than sent as empty names.
        labels: ['bug'],
        assignees: []
      })
    );
  });

  it('asks for a push only when the branch is unpushed', async () => {
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ headPushed: false })
    });

    const { feature } = await mount();
    await feature.openCreator();
    await submit();

    expect(endpoints.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pushFirst: true })
    );
  });

  it('shows the result and offers the link', async () => {
    const { feature } = await mount();
    await feature.openCreator();
    await submit();

    await vi.waitFor(() => expect($('pr-success').classList.contains('hidden')).toBe(false));
    expect($('pr-success-text').textContent).toContain('#42');
    expect($('pr-form').classList.contains('hidden')).toBe(true);
  });

  it('keeps the form and its contents when creation fails', async () => {
    // Losing a written description to a transient failure is the difference
    // between retrying and giving up.
    endpoints.createPullRequest.mockResolvedValue({
      success: false,
      error: 'GitHub said no',
      code: 'PROVIDER_ERROR'
    });

    const { feature } = await mount();
    await feature.openCreator();

    const body = $('pr-body') as HTMLTextAreaElement;
    body.value = 'A carefully written description';
    body.dispatchEvent(new Event('input'));

    await submit();

    await vi.waitFor(() => expect($('pr-feedback').textContent).toContain('GitHub said no'));
    expect($('pr-form').classList.contains('hidden')).toBe(false);
    expect(body.value).toBe('A carefully written description');
    expect($('pr-success').classList.contains('hidden')).toBe(true);
  });

  it('says the push landed and stops offering to push again', async () => {
    endpoints.preflightPullRequest.mockResolvedValue({
      success: true,
      preflight: preflight({ headPushed: false })
    });
    endpoints.createPullRequest.mockResolvedValue({
      success: false,
      error: 'Creating failed',
      code: 'PROVIDER_ERROR',
      pushed: true
    });

    const { feature } = await mount();
    await feature.openCreator();
    expect($('btn-pr-create').textContent).toBe('Push and create');

    await submit();

    await vi.waitFor(() => expect($('pr-feedback').textContent).toContain('was pushed'));
    // Retrying must not push a second time.
    expect($('btn-pr-create').textContent).toBe('Create pull request');
  });
});

describe('closing and accessibility', () => {
  it('closes on Escape', async () => {
    const { feature } = await mount();
    await feature.openCreator();

    $('pr-modal').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect($('pr-modal').classList.contains('hidden')).toBe(true);
  });

  it('closes from both the header button and Cancel', async () => {
    const { feature } = await mount();

    for (const id of ['btn-close-pr-modal', 'btn-pr-cancel']) {
      await feature.openCreator();
      $(id).click();
      expect($('pr-modal').classList.contains('hidden')).toBe(true);
    }
  });

  it('labels every field', async () => {
    await mount();

    for (const id of [
      'pr-base-branch',
      'pr-head-branch',
      'pr-title',
      'pr-body',
      'pr-reviewers',
      'pr-assignees',
      'pr-labels'
    ]) {
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label, `#${id} has no <label for>`).not.toBeNull();
      expect(label?.textContent?.trim()).not.toBe('');
    }

    // The checkboxes wrap their own label text.
    for (const id of ['pr-draft', 'pr-maintainer-edit']) {
      expect(document.querySelector(`label[for="${id}"]`), `#${id} has no label`).not.toBeNull();
    }
  });

  it('gives the close button an accessible name', async () => {
    await mount();

    expect($('btn-close-pr-modal').getAttribute('aria-label')).toBeTruthy();
    expect($('btn-create-pr').getAttribute('aria-label')).toBeTruthy();
  });

  it('announces feedback to assistive technology', async () => {
    await mount();

    expect($('pr-feedback').getAttribute('role')).toBe('status');
    expect($('pr-feedback').getAttribute('aria-live')).toBe('polite');
  });
});
