// Promises the interface makes, checked against the code that has to keep them.
//
// Every case here is a bug that shipped: a shortcut printed in a tooltip with
// nothing listening for it, a modal missing from the Escape list whose own
// Escape handler could never fire because nothing focused it, and a settings
// toggle written all the way to disk and read by nobody. None of them fail a
// behavioural test, because in each case every individual piece works -- what
// is missing is the line that joins them.
//
// Read out of the sources rather than exercised, for the same reason
// packaging.test.ts checks the element-id list that way: the joining line is a
// property of the files, and asserting on the files is what catches the next
// one being left out.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { fromAppRoot } from '../src/server/app-root';

const html = fs.readFileSync(fromAppRoot('public', 'index.html'), 'utf8');
const mainSource = fs.readFileSync(
  fromAppRoot('src', 'renderer', 'main.ts'),
  'utf8'
);

/** Every `.modal-overlay` in the page, by id. */
function modalIds(): string[] {
  return [...html.matchAll(/<div id="([a-z0-9-]+)" class="modal-overlay/g)].map((m) => m[1] as string);
}

/** The modal list `closeTopmostLayer` walks, as element keys. */
function escapeList(): string[] {
  const body = mainSource.slice(
    mainSource.indexOf('const modals = ['),
    mainSource.indexOf('];', mainSource.indexOf('const modals = ['))
  );
  return [...body.matchAll(/ui\.([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);
}

const camel = (id: string): string => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

describe('the modal layer', () => {
  // Handled by the dialog layer instead: hasOpenDialog/cancelOpenDialog run
  // ahead of the list, because a dialog raised over a modal must close first.
  const DIALOGS = ['confirm-modal', 'prompt-modal'];

  it('closes every modal on Escape', () => {
    const reachable = new Set(escapeList());

    for (const id of modalIds()) {
      if (DIALOGS.includes(id)) {
        continue;
      }
      expect(
        reachable.has(camel(id)),
        `${id} is not in closeTopmostLayer, so Escape does not close it`
      ).toBe(true);
    }
  });

  it('finds the list it is reading, so this suite cannot pass vacuously', () => {
    expect(escapeList().length).toBeGreaterThan(15);
    expect(modalIds().length).toBeGreaterThan(15);
  });

  it('announces every modal as a dialog, with a name', () => {
    for (const id of modalIds()) {
      const tag = html.slice(html.indexOf(`<div id="${id}" class="modal-overlay`));
      const opening = tag.slice(0, tag.indexOf('>'));

      expect(opening, `${id} is not marked up as a dialog`).toContain('role="dialog"');
      expect(opening, `${id} does not trap assistive tech inside it`).toContain('aria-modal="true"');

      const labelledBy = opening.match(/aria-labelledby="([a-z0-9-]+)"/)?.[1];
      expect(labelledBy, `${id} has no accessible name`).toBeTruthy();
      expect(
        html.includes(`id="${labelledBy as string}"`),
        `${id} is labelled by #${labelledBy as string}, which does not exist`
      ).toBe(true);
    }
  });
});

describe('which overlays dock and which cover', () => {
  // Seven surfaces are things you want open beside the work rather than
  // stacked on top of it: you cannot watch a rebase and read the conflict's
  // diff at once if opening one dims and freezes everything else.
  const PANELS = [
    'rebase-modal',
    'search-modal',
    'branch-admin-modal',
    'recovery-modal',
    'agents-modal',
    'worktree-modal',
    'repo-hub-modal'
  ];

  function panelIds(): string[] {
    return [...html.matchAll(/<div id="([a-z0-9-]+)" class="modal-overlay as-panel/g)].map(
      (m) => m[1] as string
    );
  }

  it('docks exactly the seven that belong beside the work', () => {
    expect(panelIds().sort()).toEqual([...PANELS].sort());
  });

  it('leaves the genuine questions as modals', () => {
    // Confirm, prompt, the passphrase dialogs and the wizards are all "answer
    // this, then continue". A question you can ignore while clicking elsewhere
    // is a worse question.
    const docked = new Set(panelIds());

    for (const id of ['confirm-modal', 'prompt-modal', 'vault-setup-modal', 'new-repo-modal', 'clone-modal', 'settings-modal']) {
      expect(docked.has(id), `${id} should stay modal`).toBe(false);
    }
  });

  it('closes a modal before a panel, whatever the list order', () => {
    // A panel sits beside the work, so a modal opened while one is docked is
    // unambiguously on top -- and Escape closing the panel underneath would be
    // answering a question nobody asked.
    const body = mainSource.slice(
      mainSource.indexOf('function closeTopmostLayer'),
      mainSource.indexOf('function wireHeader')
    );

    expect(body).toContain('isPanel(modal) === group');
  });

  it('lets Tab leave a panel, which is the point of docking one', () => {
    const focus = fs.readFileSync(fromAppRoot('src', 'renderer', 'ui', 'focus.ts'), 'utf8');

    expect(
      focus.includes("!modal.classList.contains('as-panel')"),
      'trapTab traps docked panels, so Tab cannot reach the work beside them'
    ).toBe(true);
  });
});

describe('advertised keyboard shortcuts', () => {
  /** Shortcuts named in a tooltip, as the user reads them. */
  function advertised(): string[] {
    return [...html.matchAll(/title="[^"]*\((F\d{1,2}|Ctrl\+[A-Za-z+]+)\)"/g)].map(
      (m) => m[1] as string
    );
  }

  it('binds every shortcut the interface names', () => {
    const found = advertised();
    expect(found.length, 'no tooltip advertises a shortcut; the regex has drifted').toBeGreaterThan(0);

    // Shortcuts now come from the command list: a command declares its keys
    // once and the palette row, the menu row and the handler all read that one
    // string. Two predate the registry and are still matched by hand, because
    // neither is a command -- the palette cannot open itself, and the pane
    // toggles are layout rather than an action.
    const byHand = ['Ctrl+K', 'Ctrl+B', 'Ctrl+Shift+B'];

    for (const shortcut of new Set(found)) {
      if (byHand.includes(shortcut)) {
        const key = (shortcut.split('+').pop() as string).toLowerCase();
        expect(
          mainSource.includes(`=== '${key}'`),
          `${shortcut} is handled by hand but nothing compares against it`
        ).toBe(true);
        continue;
      }

      expect(
        mainSource.includes(`shortcut: '${shortcut}'`),
        `${shortcut} is advertised in a tooltip but no command declares it`
      ).toBe(true);
    }
  });

  it('runs the shortcut a command declares, rather than a second copy of it', () => {
    // The point of moving these onto the commands: without this the hint and
    // the binding are two strings that can drift, which is how F5 came to be
    // printed in a tooltip, cited in a test comment, and bound to nothing.
    expect(mainSource).toContain('matchesShortcut(command.shortcut, key)');
    expect(mainSource).toContain('bound.run()');
  });

  it('does not fire a bare-key shortcut while the user is typing', () => {
    const shortcuts = fs.readFileSync(
      fromAppRoot('src', 'renderer', 'ui', 'shortcuts.ts'),
      'utf8'
    );

    expect(mainSource).toContain('isTypingTarget(key)');
    // A chord carrying Ctrl or Alt is not something anyone types into a commit
    // message, so those must still fire.
    expect(shortcuts).toContain('event.ctrlKey || event.metaKey || event.altKey');
  });
});

describe('what the palette and the menu offer', () => {
  it('drops the repository-scoped commands when no repository is open', () => {
    // Both surfaces read one list, so the filter has to live where the list is
    // built rather than in either of them. Without it the menu offered
    // "Interactive rebase" on the welcome screen, which opened an empty modal:
    // every repository-scoped request is refused by the client before it is
    // ever sent.
    const build = mainSource.slice(
      mainSource.indexOf('function buildCommands('),
      mainSource.indexOf('function wireGlobal(')
    );

    expect(build.length, 'buildCommands not found; the parser has drifted').toBeGreaterThan(500);
    expect(
      build.includes('hasRepo || command.needsRepo !== true'),
      'buildCommands hands back every command regardless of whether a repository is open'
    ).toBe(true);

    // The generated entries go through the same filter, so a branch cannot be
    // offered on the welcome screen either.
    expect(build).toContain('branchCommands()');
    expect(build).toContain('repositoryCommands()');

    // And the flag is set on real entries, rather than declared and never used.
    expect((build.match(/needsRepo: true/g) ?? []).length).toBeGreaterThan(10);
  });
});

describe('application settings', () => {
  const sources = new Map<string, string>();
  const collect = (...parts: string[]): string => {
    const key = parts.join('/');
    if (!sources.has(key)) {
      sources.set(key, fs.readFileSync(fromAppRoot(...parts), 'utf8'));
    }
    return sources.get(key) as string;
  };

  /** Every field of AppSettings, read from the shared type. */
  function settingNames(): string[] {
    const types = collect('src', 'shared', 'config-types.ts');
    const start = types.indexOf('export interface AppSettings {');
    const block = types.slice(start, types.indexOf('\n}', start));
    return [...block.matchAll(/^ {2}([a-zA-Z]+)\??:/gm)].map((m) => m[1] as string);
  }

  it('reads every setting it stores', () => {
    // Declaring, validating, sanitizing and offering a control are all four
    // things a setting that does nothing also does. Being read somewhere else
    // is the only one that makes it real -- storeAgentPrompts had every step
    // but this one, so ticking its box changed nothing at all.
    const plumbing = [
      ['src', 'shared', 'config-types.ts'],
      ['src', 'server', 'config', 'validate.ts'],
      ['src', 'server', 'config', 'sanitize.ts'],
      ['src', 'renderer', 'api', 'endpoints.ts'],
      ['src', 'renderer', 'features', 'settings', 'index.ts']
    ].map((parts) => parts.join('/'));

    const names = settingNames();
    expect(names.length, 'AppSettings looks empty; the parser has drifted').toBeGreaterThan(4);

    const everywhere = allSources();

    for (const name of names) {
      const consumers = [...everywhere.entries()].filter(
        ([file, text]) => !plumbing.includes(file) && text.includes(name)
      );

      expect(
        consumers.length,
        `AppSettings.${name} is stored and never read, so changing it does nothing`
      ).toBeGreaterThan(0);
    }
  });

  function allSources(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (parts: string[]): void => {
      for (const entry of fs.readdirSync(fromAppRoot(...parts), { withFileTypes: true })) {
        const next = [...parts, entry.name];
        if (entry.isDirectory()) {
          walk(next);
        } else if (entry.name.endsWith('.ts')) {
          out.set(next.join('/'), fs.readFileSync(fromAppRoot(...next), 'utf8'));
        }
      }
    };
    walk(['src']);
    return out;
  }
});
