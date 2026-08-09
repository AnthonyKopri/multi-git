// One window per repository or worktree, and the record of which were open.
//
// Two rules shape this file.
//
// The first is that a window is identified by canonical repository identity,
// not by the path string that opened it. `D:\Work\App` and `d:\work\app` are
// one folder, and "Open in new window" on the second must focus the window
// showing the first rather than opening a duplicate that fights it for the
// same index lock.
//
// The second is that nothing here touches Electron directly. The registry
// takes a factory and a display list, so the whole of it — keying, focus,
// restore, clamping — is testable without a running app, which is the only way
// the multi-monitor cases get covered at all.
import { canonicalRepoKey } from '../server/config/repo-identity';
import type { WindowRecord } from '../shared/config-types';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of BrowserWindow this registry uses. Satisfied structurally. */
export interface ManagedWindow {
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  getBounds(): WindowBounds;
  setBounds(bounds: WindowBounds): void;
  isMaximized(): boolean;
  maximize(): void;
  on(event: 'closed' | 'resized' | 'moved', listener: () => void): void;
}

export interface WindowFactory {
  (repoPath: string): ManagedWindow;
}

/** Work areas of the attached displays, in the order Electron reports them. */
export interface DisplayArea extends WindowBounds {}

export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 600;

/** How much of a window must land on a display for it to count as visible. */
const MIN_VISIBLE_PIXELS = 80;

function overlap(first: WindowBounds, second: DisplayArea): number {
  const horizontal = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const vertical = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);

  return Math.max(0, horizontal) * Math.max(0, vertical);
}

function centreOn(display: DisplayArea, size: { width: number; height: number }): WindowBounds {
  const width = Math.min(size.width, display.width);
  const height = Math.min(size.height, display.height);

  return {
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + (display.height - height) / 2),
    width,
    height
  };
}

/**
 * Puts restored bounds somewhere the user can actually reach them.
 *
 * The case this exists for: a window was last closed on a second monitor that
 * is no longer attached, so its saved position is off every display. Restoring
 * it faithfully produces a window that is running, listed in the taskbar, and
 * invisible. Anything that does not meaningfully overlap a display is centred
 * on the primary one instead.
 */
export function clampBoundsToDisplays(
  bounds: WindowBounds,
  displays: readonly DisplayArea[]
): WindowBounds {
  const primary = displays[0];
  if (!primary) {
    return bounds;
  }

  const size = {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height))
  };

  const candidate: WindowBounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), ...size };

  // The display the window sits on most, if any.
  let best: DisplayArea | null = null;
  let bestOverlap = 0;

  for (const display of displays) {
    const area = overlap(candidate, display);
    if (area > bestOverlap) {
      best = display;
      bestOverlap = area;
    }
  }

  if (!best || bestOverlap < MIN_VISIBLE_PIXELS * MIN_VISIBLE_PIXELS) {
    return centreOn(primary, size);
  }

  // On a display, but possibly hanging off its edge — a monitor that was
  // replaced by a smaller one does this. Pull it back inside.
  const width = Math.min(candidate.width, best.width);
  const height = Math.min(candidate.height, best.height);

  return {
    x: Math.round(Math.min(Math.max(candidate.x, best.x), best.x + best.width - width)),
    y: Math.round(Math.min(Math.max(candidate.y, best.y), best.y + best.height - height)),
    width,
    height
  };
}

interface Entry {
  repoPath: string;
  window: ManagedWindow;
}

export class WindowRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly factory: WindowFactory,
    private readonly onChanged: () => void = () => {}
  ) {}

  /** Number of live windows. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Shows the window for a path, creating it only if there is not one already.
   *
   * Returns the window either way, so a caller cannot tell — and does not need
   * to — whether it was new.
   */
  openOrFocus(repoPath: string): ManagedWindow {
    const key = canonicalRepoKey(repoPath);
    const existing = this.entries.get(key);

    if (existing && !existing.window.isDestroyed()) {
      existing.window.focus();
      return existing.window;
    }

    const window = this.factory(repoPath);
    this.entries.set(key, { repoPath, window });
    this.track(window);

    return window;
  }

  /** Wires the listeners that keep the map and the saved layout honest. */
  private track(window: ManagedWindow): void {
    window.on('closed', () => {
      // Searched by identity rather than deleted by key: the window may have
      // been re-keyed since, and deleting `key` would evict whichever window
      // holds it now.
      for (const [existingKey, entry] of [...this.entries]) {
        if (entry.window === window) {
          this.entries.delete(existingKey);
        }
      }
      this.onChanged();
    });

    // Bounds are recorded as they change rather than only at quit, so a crash
    // or a forced shutdown still restores something close to reality.
    window.on('resized', this.onChanged);
    window.on('moved', this.onChanged);

    this.onChanged();
  }

  /**
   * Registers a window this registry did not build.
   *
   * Restore needs it: those windows are created with their saved bounds, which
   * the factory does not know about, but they must still be tracked, keyed and
   * saved like any other.
   */
  adopt(repoPath: string, window: ManagedWindow): ManagedWindow {
    const key = canonicalRepoKey(repoPath);
    this.entries.set(key, { repoPath, window });
    this.track(window);
    return window;
  }

  /**
   * Moves a window to the repository it now shows.
   *
   * A window can start out with no repository — the one opened at launch — or
   * be pointed at a different one by the user. Without this, "Open in new
   * window" for a repository already on screen would open a second window for
   * it, and the two would compete for the same index lock.
   */
  rekey(window: ManagedWindow, repoPath: string): void {
    const key = canonicalRepoKey(repoPath);
    if (key === '') {
      return;
    }

    for (const [existingKey, entry] of [...this.entries]) {
      if (entry.window === window) {
        this.entries.delete(existingKey);
      }
    }

    // A window already registered for this repository loses the key rather
    // than being closed: two windows on one repository is a state the user can
    // reach by other means, and the newest claim is the accurate one.
    this.entries.set(key, { repoPath, window });
    this.onChanged();
  }

  /** The live window for a path, or null. */
  find(repoPath: string): ManagedWindow | null {
    const entry = this.entries.get(canonicalRepoKey(repoPath));
    return entry && !entry.window.isDestroyed() ? entry.window : null;
  }

  focus(repoPath: string): boolean {
    const window = this.find(repoPath);
    window?.focus();
    return window !== null;
  }

  /** Paths of every live window, in the order they were opened. */
  openPaths(): string[] {
    return [...this.entries.values()]
      .filter((entry) => !entry.window.isDestroyed())
      .map((entry) => entry.repoPath);
  }

  /** What to persist so these windows can be reopened. */
  snapshot(): WindowRecord[] {
    return [...this.entries.values()]
      .filter((entry) => !entry.window.isDestroyed())
      .map((entry) => {
        const record: WindowRecord = { repoPath: entry.repoPath };

        try {
          record.bounds = entry.window.getBounds();
          if (entry.window.isMaximized()) {
            record.maximized = true;
          }
        } catch {
          // A window torn down between the filter and here. The path alone is
          // still worth restoring.
        }

        return record;
      });
  }

  closeAll(): void {
    for (const entry of [...this.entries.values()]) {
      if (!entry.window.isDestroyed()) {
        entry.window.close();
      }
    }
  }
}

/**
 * Filters saved windows down to the ones worth reopening.
 *
 * A repository deleted since the last run must not reopen as an error dialog,
 * and two records naming the same folder — easy to produce by opening a
 * junction and its target — must not become two windows fighting over it.
 */
export function restorableWindows(
  records: readonly WindowRecord[],
  exists: (repoPath: string) => boolean
): WindowRecord[] {
  const seen = new Set<string>();
  const restorable: WindowRecord[] = [];

  for (const record of records) {
    const key = canonicalRepoKey(record.repoPath);
    if (key === '' || seen.has(key) || !exists(record.repoPath)) {
      continue;
    }

    seen.add(key);
    restorable.push(record);
  }

  return restorable;
}
