// A keyboard-first way to reach anything.
//
// The palette indexes app actions and the safe Git actions that apply to the
// repository as it currently stands. Anything destructive is deliberately
// still routed through its normal confirmation — the palette is a faster way
// to *start* an action, never a way to skip the question it asks.
import type { Elements } from '../../dom/elements';
import { asInput } from '../../dom/elements';
import { el, fragment, setHidden } from '../../dom/create';

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
                el('span', { className: 'palette-title', text: command.title })
              ]
            });
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(index === highlighted));
            return row;
          })
        )
  );
}

function refilter(): void {
  visible = rankCommands(asInput(ui.paletteInput).value, commands);
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
