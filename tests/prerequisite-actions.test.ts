// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prerequisiteAction } from '../src/renderer/features/setup';
import type { PrerequisiteState } from '../src/shared/prerequisite-types';

const missingGh: PrerequisiteState = {
  id: 'gh',
  label: 'GitHub CLI',
  installed: false,
  signedIn: false,
  detail: 'Optional.'
};

afterEach(() => {
  delete window.desktopApi;
});

describe('GitHub CLI prerequisite action', () => {
  it('links to the official installation page outside the desktop app', () => {
    const action = prerequisiteAction(missingGh) as HTMLAnchorElement;
    expect(action.tagName).toBe('A');
    expect(action.href).toBe('https://cli.github.com/');
    expect(action.textContent).toBe('Install GitHub CLI');
  });

  it('starts the desktop installer when available', async () => {
    const install = vi.fn().mockResolvedValue({ started: true, via: 'winget' });
    window.desktopApi = { installPrerequisite: install } as unknown as NonNullable<typeof window.desktopApi>;
    const action = prerequisiteAction(missingGh) as HTMLButtonElement;
    expect(action.tagName).toBe('BUTTON');
    action.click();
    await vi.waitFor(() => expect(install).toHaveBeenCalledWith('gh'));
  });
});
