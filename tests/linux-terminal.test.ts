// Opening a terminal on Linux.
//
// There is no terminal every distribution ships: Debian has x-terminal-emulator,
// Fedora has Ptyxis or GNOME Terminal, KDE has Konsole. And a window started
// without the desktop session variables has no screen to open on. Both used to
// make the Terminal button do nothing, so both are pinned here.
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { linuxTerminalPlans, revealPlanFor, withDesktopSession } from '../src/server/agents/launch';
import { openTerminalAt } from '../src/server/agents/service';
import type { DetachedLauncher } from '../src/server/process/runner';
import { FakeRunner } from './helpers/fake-runner';
import { withPlatform } from './helpers/platform';

const session = {
  PATH: '/usr/bin',
  HOME: '/home/me',
  DISPLAY: ':0',
  WAYLAND_DISPLAY: 'wayland-0',
  XDG_RUNTIME_DIR: '/run/user/1000',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  SSH_ASKPASS: '/opt/multi-git/askpass'
};

/** A runner whose `which` finds only the named programs. */
function installed(...programs: string[]): FakeRunner {
  return new FakeRunner().on(
    (executable, args) => executable === 'which' && programs.includes(args[0] ?? ''),
    (call) => ({ stdout: `/usr/bin/${call.args[0]}\n` })
  );
}

function recordingLauncher(): DetachedLauncher & { launched: Array<{ executable: string; args: readonly string[] }> } {
  const launched: Array<{ executable: string; args: readonly string[] }> = [];
  return {
    launched,
    async launch(executable, args) {
      launched.push({ executable, args });
      return { pid: 1 };
    }
  };
}

describe('the Linux terminal', () => {
  it('gives a window the desktop session, and still not the askpass bridge', async () => {
    await withPlatform('linux', async () => {
      const env = withDesktopSession({ PATH: '/usr/bin' }, session);

      expect(env['DISPLAY']).toBe(':0');
      expect(env['WAYLAND_DISPLAY']).toBe('wayland-0');
      expect(env['DBUS_SESSION_BUS_ADDRESS']).toBe(session.DBUS_SESSION_BUS_ADDRESS);
      expect(env['SSH_ASKPASS']).toBeUndefined();
      expect(revealPlanFor('/home/me/repo', session).env['DISPLAY']).toBe(':0');
    });
  });

  it('leaves Windows and macOS environments as they were', async () => {
    for (const platform of ['win32', 'darwin'] as const) {
      await withPlatform(platform, async () => {
        expect(withDesktopSession({ PATH: 'x' }, session)).toEqual({ PATH: 'x' });
      });
    }
  });

  it('tells each terminal the folder, since some open windows from a server', async () => {
    await withPlatform('linux', async () => {
      const plans = linuxTerminalPlans('/home/me/my repo', {}, session);
      const byName = new Map(plans.map((plan) => [plan.executable, plan.args]));

      expect(plans[0]?.executable).toBe('x-terminal-emulator');
      expect(byName.get('gnome-terminal')).toEqual(['--working-directory=/home/me/my repo']);
      expect(byName.get('konsole')).toEqual(['--workdir', '/home/me/my repo']);
      expect(plans.every((plan) => plan.cwd === '/home/me/my repo')).toBe(true);
    });
  });

  it('puts a TERMINAL the user named first, and ignores one carrying arguments', async () => {
    await withPlatform('linux', async () => {
      expect(linuxTerminalPlans('/r', {}, { ...session, TERMINAL: 'kitty' })[0]).toMatchObject({
        executable: 'kitty',
        args: ['--directory', '/r']
      });
      expect(linuxTerminalPlans('/r', {}, { ...session, TERMINAL: 'kitty -e sh' })[0]?.executable).toBe(
        'x-terminal-emulator'
      );
    });
  });

  it('opens whichever terminal is installed when x-terminal-emulator is not', async () => {
    await withPlatform('linux', async () => {
      const launcher = recordingLauncher();
      const folder = os.tmpdir();

      await openTerminalAt(folder, { runner: installed('konsole'), launcher });

      expect(launcher.launched).toEqual([{ executable: 'konsole', args: ['--workdir', folder] }]);
    });
  });

  it('says what to do when no terminal is installed at all', async () => {
    await withPlatform('linux', async () => {
      const launcher = recordingLauncher();

      await expect(openTerminalAt(os.tmpdir(), { runner: installed(), launcher })).rejects.toThrow(
        /No terminal emulator was found/
      );
      expect(launcher.launched).toEqual([]);
    });
  });
});
