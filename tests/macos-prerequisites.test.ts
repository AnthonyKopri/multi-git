import { describe, expect, it } from 'vitest';

import { installPrerequisite, prerequisitePackage } from '../src/server/agents/service';
import { detectPrerequisites } from '../src/server/tools/prerequisites';
import { FakeRunner } from './helpers/fake-runner';

describe('macOS prerequisites', () => {
  it('does not present Git Bash as missing on a healthy Mac', async () => {
    const runner = new FakeRunner().otherwise({ stdout: 'tool version 1.0\n' });

    const report = await detectPrerequisites(runner, 'darwin');

    expect(report.tools.map((tool) => tool.id)).toEqual(['git', 'gh']);
    expect(report.canInstall).toBe(false);
  });

  it('opens the macOS Git download when Git is missing', async () => {
    const launches: { executable: string; args: readonly string[] }[] = [];
    const launcher = {
      launch: async (executable: string, args: readonly string[]) => {
        launches.push({ executable, args });
        return { pid: 42 };
      }
    };

    const outcome = await installPrerequisite('git', {
      platform: 'darwin',
      runner: new FakeRunner(),
      launcher
    });

    expect(prerequisitePackage('git', 'darwin')?.label).toBe('Git for macOS');
    expect(outcome).toEqual({
      started: false,
      via: 'browser',
      url: 'https://git-scm.com/download/mac'
    });
    expect(launches).toEqual([
      {
        executable: 'open',
        args: ['https://git-scm.com/download/mac']
      }
    ]);
  });
});
