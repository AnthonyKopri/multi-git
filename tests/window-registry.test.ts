// One window per repository, and where a restored window ends up.
//
// The registry takes a factory and a display list precisely so this file can
// exist. Multi-monitor restore is the case nobody hits until they undock a
// laptop, and it is impossible to cover at all if the only way to run the code
// is to launch Electron.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WindowRegistry,
  clampBoundsToDisplays,
  restorableWindows
} from '../src/main/window-registry';
import type { DisplayArea, ManagedWindow, WindowBounds } from '../src/main/window-registry';

/** A stand-in for BrowserWindow that records what was asked of it. */
function fakeWindow(bounds: WindowBounds = { x: 0, y: 0, width: 1280, height: 850 }) {
  const listeners = new Map<string, (() => void)[]>();
  let destroyed = false;
  let maximized = false;

  const window = {
    focusCount: 0,
    closed: false,
    focus() {
      window.focusCount += 1;
    },
    close() {
      window.closed = true;
      destroyed = true;
      for (const listener of listeners.get('closed') ?? []) {
        listener();
      }
    },
    isDestroyed: () => destroyed,
    getBounds: () => bounds,
    setBounds(next: WindowBounds) {
      bounds = next;
    },
    isMaximized: () => maximized,
    maximize() {
      maximized = true;
    },
    on(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    /** Fires an event the way Electron would. */
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    }
  };

  return window;
}

type FakeWindow = ReturnType<typeof fakeWindow>;

function registryWith(onChanged = vi.fn()) {
  const built: { repoPath: string; window: FakeWindow }[] = [];

  const registry = new WindowRegistry((repoPath) => {
    const window = fakeWindow();
    built.push({ repoPath, window });
    return window as unknown as ManagedWindow;
  }, onChanged);

  return { registry, built, onChanged };
}

describe('opening and focusing', () => {
  it('creates a window the first time and focuses it after that', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus('D:\\work\\app');
    registry.openOrFocus('D:\\work\\app');

    expect(built).toHaveLength(1);
    expect(built[0]?.window.focusCount).toBe(1);
  });

  it('treats two spellings of one folder as one window', () => {
    // The case that produces two windows fighting over the same index lock.
    const { registry, built } = registryWith();

    registry.openOrFocus(path.join('D:', 'work', 'app'));
    registry.openOrFocus(path.join('D:', 'work', 'app') + path.sep);

    expect(built).toHaveLength(1);
  });

  it('keeps different repositories in different windows', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus(path.join('D:', 'work', 'app'));
    registry.openOrFocus(path.join('D:', 'work', 'other'));

    expect(built).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it('forgets a window when it closes', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus('D:\\work\\app');
    built[0]?.window.close();

    expect(registry.size).toBe(0);
    expect(registry.find('D:\\work\\app')).toBeNull();
  });

  it('reopens after a close rather than focusing a dead window', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus('D:\\work\\app');
    built[0]?.window.close();
    registry.openOrFocus('D:\\work\\app');

    expect(built).toHaveLength(2);
  });

  it('reports whether a path already has a window', () => {
    const { registry } = registryWith();

    expect(registry.focus('D:\\work\\app')).toBe(false);
    registry.openOrFocus('D:\\work\\app');
    expect(registry.focus('D:\\work\\app')).toBe(true);
  });
});

describe('re-keying a window to the repository it now shows', () => {
  it('moves the window opened with no repository onto the one it opens', () => {
    // The launch window starts empty and the renderer claims it once a
    // repository loads. Without this, "open in a new window" for that same
    // repository would open a duplicate.
    const { registry, built } = registryWith();

    registry.openOrFocus('');
    const window = built[0]?.window as FakeWindow;
    registry.rekey(window as unknown as ManagedWindow, 'D:\\work\\app');

    registry.openOrFocus('D:\\work\\app');

    expect(built).toHaveLength(1);
    expect(window.focusCount).toBe(1);
  });

  it('does not leave the window listed under its old key', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus('D:\\work\\app');
    registry.rekey(built[0]?.window as unknown as ManagedWindow, 'D:\\work\\other');

    expect(registry.find('D:\\work\\app')).toBeNull();
    expect(registry.find('D:\\work\\other')).not.toBeNull();
    expect(registry.size).toBe(1);
  });

  it('ignores a claim with no usable path', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus('D:\\work\\app');
    registry.rekey(built[0]?.window as unknown as ManagedWindow, '   ');

    expect(registry.find('D:\\work\\app')).not.toBeNull();
  });

  it('removes the right entry when a re-keyed window closes', () => {
    const { registry, built } = registryWith();

    registry.openOrFocus('');
    const window = built[0]?.window as FakeWindow;
    registry.rekey(window as unknown as ManagedWindow, 'D:\\work\\app');
    window.close();

    expect(registry.size).toBe(0);
  });
});

describe('recording the layout', () => {
  it('snapshots the path and bounds of every live window', () => {
    const { registry } = registryWith();

    registry.openOrFocus('D:\\work\\app');
    const snapshot = registry.snapshot();

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.repoPath).toBe('D:\\work\\app');
    expect(snapshot[0]?.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 850 });
  });

  it('asks to be saved when a window moves or is resized', () => {
    const onChanged = vi.fn();
    const { registry, built } = registryWith(onChanged);

    registry.openOrFocus('D:\\work\\app');
    onChanged.mockClear();

    built[0]?.window.emit('moved');
    built[0]?.window.emit('resized');

    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('lists open paths in the order they were opened', () => {
    const { registry } = registryWith();

    registry.openOrFocus('D:\\work\\a');
    registry.openOrFocus('D:\\work\\b');

    expect(registry.openPaths()).toEqual(['D:\\work\\a', 'D:\\work\\b']);
  });
});

describe('restorableWindows', () => {
  it('drops a repository that is no longer on disk', () => {
    const restorable = restorableWindows(
      [{ repoPath: 'D:\\work\\gone' }, { repoPath: 'D:\\work\\here' }],
      (repoPath) => repoPath.endsWith('here')
    );

    expect(restorable.map((record) => record.repoPath)).toEqual(['D:\\work\\here']);
  });

  it('collapses two records naming the same folder', () => {
    // Opening a junction and its target produces exactly this, and restoring
    // both would open two windows competing for one repository.
    const restorable = restorableWindows(
      [{ repoPath: path.join('D:', 'work', 'app') }, { repoPath: path.join('D:', 'work', 'app') + path.sep }],
      () => true
    );

    expect(restorable).toHaveLength(1);
  });

  it('drops a record with no usable path', () => {
    expect(restorableWindows([{ repoPath: '  ' }], () => true)).toEqual([]);
  });

  it('keeps the bounds it was given', () => {
    const bounds = { x: 10, y: 20, width: 1000, height: 700 };
    const [restored] = restorableWindows([{ repoPath: 'D:\\work\\app', bounds }], () => true);

    expect(restored?.bounds).toEqual(bounds);
  });
});

describe('clamping restored bounds to the displays that exist', () => {
  const primary: DisplayArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const secondary: DisplayArea = { x: 1920, y: 0, width: 2560, height: 1400 };

  it('leaves a window that is fully on a display alone', () => {
    const bounds = { x: 100, y: 100, width: 1280, height: 850 };
    expect(clampBoundsToDisplays(bounds, [primary, secondary])).toEqual(bounds);
  });

  it('keeps a window on the second monitor when it is still attached', () => {
    const bounds = { x: 2000, y: 200, width: 1280, height: 850 };
    expect(clampBoundsToDisplays(bounds, [primary, secondary])).toEqual(bounds);
  });

  it('recentres a window whose monitor has gone', () => {
    // Undocking a laptop. Restoring this faithfully produces a window that is
    // running, in the taskbar, and invisible.
    const orphaned = { x: 2600, y: 300, width: 1280, height: 850 };
    const clamped = clampBoundsToDisplays(orphaned, [primary]);

    expect(clamped).toEqual({ x: 320, y: 95, width: 1280, height: 850 });
  });

  it('recentres a window at a wildly negative position', () => {
    const clamped = clampBoundsToDisplays(
      { x: -5000, y: -5000, width: 1280, height: 850 },
      [primary]
    );

    expect(clamped.x).toBeGreaterThanOrEqual(primary.x);
    expect(clamped.y).toBeGreaterThanOrEqual(primary.y);
  });

  it('pulls a window back inside a display that shrank', () => {
    const smaller: DisplayArea = { x: 0, y: 0, width: 1366, height: 768 };
    const clamped = clampBoundsToDisplays({ x: 1000, y: 600, width: 1280, height: 850 }, [smaller]);

    expect(clamped.width).toBe(1280);
    expect(clamped.height).toBe(768);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(smaller.width);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(smaller.height);
  });

  it('never restores a window too small to use', () => {
    const clamped = clampBoundsToDisplays({ x: 0, y: 0, width: 120, height: 80 }, [primary]);

    expect(clamped.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
    expect(clamped.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT);
  });

  it('recentres a window that only just clips a corner', () => {
    // Twenty pixels on screen is not "visible" in any useful sense.
    const clamped = clampBoundsToDisplays(
      { x: 1900, y: 1020, width: 1280, height: 850 },
      [primary]
    );

    expect(clamped.x).toBeLessThan(1900);
  });

  it('does nothing when there are no displays to reason about', () => {
    const bounds = { x: 4000, y: 4000, width: 800, height: 600 };
    expect(clampBoundsToDisplays(bounds, [])).toEqual(bounds);
  });
});
