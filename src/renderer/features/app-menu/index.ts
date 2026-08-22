// The navbar overflow menu.
//
// The strip along the top had grown to eight buttons, most of them opening
// something rather than doing something. Five remain — fetch, pull, push, the
// pull-request button and the auto-pull chip — and the rest live behind one
// glyph.
//
// The rows are not a second list of actions. They are the command palette's
// own entries, filtered to the ones worth a menu: `buildCommands` in main.ts is
// already the single registry of everything this application can start, and a
// hand-written menu beside it would be a second registry to keep in step. An
// entry earns a row by carrying a `menu` group, so adding one is a word on the
// command that already exists.
//
// What the menu deliberately is not: everything. The palette indexes forty-odd
// commands and is the right tool for reaching an unusual one. A menu of forty
// rows is a worse palette, so this shows the dozen that people hunt for with a
// mouse.
import { closeAllDropdowns, registerDropdown } from '../../ui/dropdown';
import { el, fragment, icon } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import type { Command } from '../palette';

/** Groups in the order they appear. A command's `menu` names one of these. */
const GROUP_ORDER: readonly string[] = ['Repository', 'History', 'Safety Net'];

let ui: Elements;
let readCommands: () => readonly Command[] = () => [];
let commands: readonly Command[] = [];

/**
 * Wires the menu.
 *
 * `commandsFor` is called each time the menu opens rather than once at
 * startup, because what is worth offering depends on whether a repository is
 * open and which branch it is on — the same reason the palette rebuilds its
 * set on every open.
 */
export function initAppMenu(elements: Elements, commandsFor: () => readonly Command[]): void {
  ui = elements;
  readCommands = commandsFor;

  // The same registry the header segments use, so opening this closes those,
  // an outside click closes it, and the rows are built when it opens rather
  // than on every state change behind a menu nobody has looked at.
  registerDropdown(ui.btnAppMenu, ui.appMenuDropdown, render);

  ui.appMenuDropdown.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-command-id]');
    const id = row?.dataset['commandId'];

    if (id === undefined) {
      return;
    }

    // Closed before the command runs: several of these open a modal, and a
    // menu still standing over it is a menu the user has to dismiss twice.
    closeAllDropdowns();
    commands.find((command) => command.id === id)?.run();
  });

  // Arrow keys move between rows, which is what a menu is expected to do and
  // the only way to reach one from a keyboard once it is open.
  ui.appMenuDropdown.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) {
      return;
    }

    event.preventDefault();
    const rows = [...ui.appMenuDropdown.querySelectorAll<HTMLElement>('[data-command-id], .btn-menu-row')];
    const index = rows.findIndex((row) => row === document.activeElement);
    const next = rows[(index + step + rows.length) % rows.length];
    next?.focus();
  });
}

function menuRow(command: Command): HTMLLIElement {
  const row = el('li', {
    className: 'dropdown-item app-menu-item',
    data: { commandId: command.id },
    attrs: { role: 'menuitem', tabindex: '-1' },
    children: [
      command.icon === undefined ? null : icon(command.icon, 16),
      el('span', { text: command.title })
    ]
  }) as HTMLLIElement;

  return row;
}

function render(): void {
  commands = readCommands();
  const rows = commands.filter((command) => command.menu !== undefined);

  if (rows.length === 0) {
    ui.appMenuList.replaceChildren(
      el('li', { className: 'dropdown-empty', text: 'Open a repository first' })
    );
    return;
  }

  const groups = [...new Set(rows.map((command) => command.menu as string))].sort(
    (left, right) => GROUP_ORDER.indexOf(left) - GROUP_ORDER.indexOf(right)
  );

  ui.appMenuList.replaceChildren(
    fragment(
      groups.flatMap((group) => [
        el('li', { className: 'dropdown-title', text: group }),
        ...rows.filter((command) => command.menu === group).map(menuRow)
      ])
    )
  );
}
