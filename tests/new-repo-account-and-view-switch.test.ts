// New Repository's account picker and folder rules, and where the view
// switch's highlight sits.
import { describe, expect, it } from 'vitest';

import type { ClientSshProfile } from '../src/shared/config-types';
import { describeAccountChoice, initialAccountChoice } from '../src/renderer/features/new-repo/account-choice';
import { joinRepoPath, repoNameProblem } from '../src/renderer/features/new-repo/folder-choice';
import { thumbPlacement } from '../src/renderer/ui/slide-switch';

function profile(overrides: Partial<ClientSshProfile>): ClientSshProfile {
  return { id: 'work', label: 'Work', ...overrides } as ClientSshProfile;
}

const work = profile({ id: 'work', label: 'Work', userName: 'Ada Work', userEmail: 'ada@work.example' });
const home = profile({ id: 'home', label: 'Home', userName: 'Ada', userEmail: 'ada@home.example' });

describe('the account a new repository starts with', () => {
  it('prefers the default account for new folders', () => {
    expect(initialAccountChoice([work, home], 'home', 'work')).toBe('home');
  });

  it('falls back to the account this window is using', () => {
    expect(initialAccountChoice([work, home], '', 'work')).toBe('work');
  });

  it('skips an id that no longer names an account, and ends on System SSH', () => {
    expect(initialAccountChoice([work, home], 'deleted', 'home')).toBe('home');
    expect(initialAccountChoice([work], 'deleted', 'gone')).toBe('');
    expect(initialAccountChoice([], '', '')).toBe('');
  });
});

describe('what the picker says about a choice', () => {
  it('says System SSH keeps what the computer already has', () => {
    expect(describeAccountChoice(null)).toMatch(/already has set up/);
  });

  it('names the author and the key', () => {
    expect(describeAccountChoice(work)).toBe(
      'Commits are made as Ada Work <ada@work.example>, and pushes use the "Work" key.'
    );
  });

  it('uses the label when the account has an email but no name', () => {
    expect(describeAccountChoice(profile({ label: 'Bot', userEmail: 'bot@example.com' }))).toContain('Bot <bot@example.com>');
  });

  it('says the global identity is used when the account has no email', () => {
    expect(describeAccountChoice(profile({ label: 'Keys only' }))).toMatch(/global Git name and email.*"Keys only" key/);
  });
});

describe('the view switch highlight', () => {
  it('sits under the chosen button', () => {
    expect(thumbPlacement({ offsetLeft: 139, offsetWidth: 96 })).toEqual({ x: 139, width: 96 });
  });

  it('collapses when nothing is chosen', () => {
    expect(thumbPlacement(null)).toEqual({ x: 0, width: 0 });
  });
});

describe('where a new repository is made', () => {
  it('puts the name inside the parent, with the parent\'s own separator', () => {
    expect(joinRepoPath('D:\\Projects', 'app')).toBe('D:\\Projects\\app');
    expect(joinRepoPath('D:\\Projects\\', 'app')).toBe('D:\\Projects\\app');
    expect(joinRepoPath('/home/ada/code/', ' app ')).toBe('/home/ada/code/app');
    expect(joinRepoPath('D:/Projects', 'app')).toBe('D:/Projects/app');
  });

  it('keeps a root\'s one separator', () => {
    expect(joinRepoPath('C:\\', 'app')).toBe('C:\\app');
    expect(joinRepoPath('/', 'app')).toBe('/app');
  });

  it('accepts ordinary names', () => {
    for (const name of ['app', 'my-project', 'Multi Git 2', 'v1.2', '.dotfiles']) {
      expect(repoNameProblem(name)).toBeNull();
    }
  });

  it('refuses names that cannot be a folder everywhere', () => {
    for (const name of ['', '  ', '.', '..', 'a/b', 'a\\b', 'what?', 'ends.', 'CON', 'lpt1.txt']) {
      expect(repoNameProblem(name)).not.toBeNull();
    }
  });
});
