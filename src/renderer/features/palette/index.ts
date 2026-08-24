// A keyboard-first way to reach anything.
//
// The palette indexes app actions and the safe Git actions that apply to the
// repository as it currently stands. Anything destructive is deliberately
// still routed through its normal confirmation — the palette is a faster way
// to *start* an action, never a way to skip the question it asks.
import type { Elements } from '../../dom/elements';
import { asInput } from '../../dom/elements';
import { el, fragment, setHidden } from '../../dom/create';
import { displayShortcut } from '../../ui/shortcuts';

export interface Command {
  id: string;
  title: string;
  /** Grouping shown beside the title: "Repository", "Branch", "Diff". */
  group: string;
  /** Extra words that should match, such as a synonym the user might type. */
  keywords?: string;
  /**
   * Section of the navbar menu this belongs in, when it belongs in one.
   *
   * The palette indexes everything; the menu shows the handful worth hunting
   * for with a mouse. Naming the section on the command keeps both surfaces
   * reading from this one list.
   */
  menu?: string;
  /** Material symbol for the menu row. Unused by the palette. */
  icon?: string;
  /**
   * The keys that also run this, written as the user would say them.
   *
   * Shown beside the row in both surfaces. Kept on the command rather than in a
   * table beside it so the hint cannot drift from the binding, and because the
   * palette is where anyone would look to find out that these exist -- nothing
   * else in the window teaches them.
   */
  shortcut?: string;
  /**
   * Set when the command cannot do anything without a repository open.
   *
   * The navbar sits outside the container that is blurred and made
   * click-through while no repository is open, so the palette and the menu are
   * both reachable in that state. Offering "Interactive rebase" there opened an
   * empty modal and logged a failure, because every repository-scoped request
   * is refused by the client before it is sent.
   */
  needsRepo?: boolean;
  run: () => void;
}

let ui: Elements;
let commands: Command[] = [];
let visible: Command[] = [];
let highlighted = 0;

export function initPalette(elements: Elements): void {
  ui = elements;
}

/** Replaces the command set. Called whenever what is available changes. */
export function setCommands(next: readonly Command[]): void {
  commands = [...next];
}

/**
 * Subsequence match, the same rule every palette uses: the letters of the
 * query appear in order somewhere in the text. "brdel" finds "Branch: delete".
 */
export function matches(query: string, text: string): boolean {
  if (query === '') {
    return true;
  }

  const haystack = text.toLowerCase();
  let index = 0;

  for (const character of query.toLowerCase()) {
    if (character === ' ') {
      continue;
    }
    index = haystack.indexOf(character, index);
    if (index === -1) {
      return false;
    }
    index += 1;
  }

  return true;
}

/** Ranks an exact substring above a scattered subsequence. */
export function rankCommands(query: string, all: readonly Command[]): Command[] {
  const needle = query.trim().toLowerCase();

  const scored = all
    .map((command) => {
      const text = `${command.group} ${command.title} ${command.keywords ?? ''}`;
      if (!matches(needle, text)) {
        return null;
      }
      const direct = text.toLowerCase().includes(needle);
      return { command, score: direct ? 0 : 1 };
    })
    .filter((entry): entry is { command: Command; score: number } => entry !== null);

  scored.sort((left, right) => left.score - right.score);
  return scored.map((entry) => entry.command);
}

function renderList(): void {
  ui.paletteList.replaceChildren(
    visible.length === 0
      ? el('li', { className: 'empty-state', text: 'No matching command' })
      : fragment(
          visible.map((command, index) => {
            const row = el('li', {
              className: `palette-item${index === highlighted ? ' palette-item-active' : ''}`,
              data: { commandId: command.id },
              children: [
                el('span', { className: 'palette-group', text: command.group }),
                el('span', { className: 'palette-title', text: command.title }),
                command.shortcut === undefined
                  ? null
                  : el('span', {
                      className: 'palette-shortcut',
                      text: displayShortcut(command.shortcut)
                    })
              ]
            });
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(index === highlighted));
            return row;
          })
        )
  );
}

/**
 * Rows drawn at once.
 *
 * The list now includes every branch and every recent repository, so an empty
 * query in a repository with eighty branches would otherwise draw a hundred and
 * twenty rows nobody scrolls. The match itself is not capped -- typing narrows
 * the whole set, and it is only the drawing that stops here.
 *
 * Comfortably above the number of fixed commands on purpose. A cap at or below
 * it would put the ceiling exactly where the generated entries begin, so an
 * unfiltered palette would never show a branch at all -- the category would
 * look missing rather than merely further down.
 */
const MAX_VISIBLE = 60;

function refilter(): void {
  visible = rankCommands(asInput(ui.paletteInput).value, commands).slice(0, MAX_VISIBLE);
  highlighted = 0;
  renderList();
}

export function openPalette(): void {
  setHidden(ui.paletteModal, false);
  const input = asInput(ui.paletteInput);
  input.value = '';
  refilter();
  // The modal is still being shown when this runs, so focus waits a tick.
  setTimeout(() => input.focus(), 20);
}

export function closePalette(): void {
  setHidden(ui.paletteModal, true);
}

export function isPaletteOpen(): boolean {
  return !ui.paletteModal.classList.contains('hidden');
}

function runHighlighted(): void {
  const command = visible[highlighted];
  if (!command) {
    return;
  }

  // Close first: a command that opens another modal should not be layered
  // underneath this one.
  closePalette();
  command.run();
}

function move(delta: number): void {
  if (visible.length === 0) {
    return;
  }
  highlighted = (highlighted + delta + visible.length) % visible.length;
  renderList();

  ui.paletteList.children[highlighted]?.scrollIntoView({ block: 'nearest' });
}

/** Wires the input's own keys. Returns nothing; the caller owns the global key. */
export function attachPaletteInput(): void {
  ui.paletteInput.addEventListener('input', () => refilter());

  ui.paletteInput.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;

    switch (key.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Enter':
        event.preventDefault();
        runHighlighted();
        return;
      case 'Escape':
        event.preventDefault();
        closePalette();
    }
  });

  ui.paletteModal.addEventListener('click', (event) => {
    if (event.target === ui.paletteModal) {
      closePalette();
    }
  });
}

/** Runs the command a clicked row names. */
export function runCommandById(id: string): void {
  const command = commands.find((candidate) => candidate.id === id);
  if (command) {
    closePalette();
    command.run();
  }
}
