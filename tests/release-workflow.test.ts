// What .github/workflows/release.yml and the release scripts have to agree on.
//
// The workflow cannot be run by a test, and a disagreement with the scripts
// only shows up during a release: a build uploaded under a name the upload
// does not look for, or a platform added to the asset table that no job
// builds. These read the workflow as text and check the names line up.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { fromAppRoot } from '../src/server/app-root';

const require = createRequire(import.meta.url);
const { RELEASE_ASSETS } = require('../scripts/release-assets.js') as {
  RELEASE_ASSETS: Record<string, { basename(version: string): string }>;
};

// Normalized: a Windows checkout has the workflow with CRLF endings.
const workflow = fs
  .readFileSync(fromAppRoot('.github', 'workflows', 'release.yml'), 'utf8')
  .replace(/\r\n/g, '\n');

/** Every path glob under an upload-artifact step's `path:`, one entry per line. */
function uploadedGlobs(): string[] {
  const globs: string[] = [];
  const lines = workflow.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!/uses: actions\/upload-artifact@/.test(lines[index] ?? '')) continue;

    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? '';
      if (/^\s*- (uses|name):/.test(line) || /^ {2}\w/.test(line)) break;

      const single = /^\s+path: (\S.*)$/.exec(line)?.[1];
      if (single !== undefined && single !== '|') {
        globs.push(single.trim());
        continue;
      }
      if (/^\s+path: \|$/.test(line)) {
        for (let item = next + 1; item < lines.length && /^\s{12,}\S/.test(lines[item] ?? ''); item += 1) {
          globs.push((lines[item] ?? '').trim());
        }
      }
    }
  }

  return globs;
}

const toRegExp = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);

describe('the Release workflow', () => {
  it('builds every asset a release carries, under the name the upload looks for', () => {
    // Adding a platform to RELEASE_ASSETS without a job that builds it would
    // otherwise be found by the upload, at release time.
    const globs = uploadedGlobs().map(toRegExp);

    for (const [kind, spec] of Object.entries(RELEASE_ASSETS)) {
      for (const version of ['5.0.0', '5.0.0-beta.1']) {
        const expected = `dist/${spec.basename(version)}`;
        expect(
          globs.some((glob) => glob.test(expected)),
          `no build job uploads ${expected} (${kind})`
        ).toBe(true);
      }
    }
  });

  it('collects every build job’s artifact into dist/, where the upload reads', () => {
    // A build uploaded under a name outside the pattern would never reach
    // the publish job, which would then stop on a missing file.
    const artifacts = [...workflow.matchAll(/^ {10}name: (\S+)$/gm)].map((match) => match[1]);
    const builds = artifacts.filter((name) => name !== 'release-preview');

    expect(builds.length).toBeGreaterThanOrEqual(2);
    for (const name of builds) {
      expect(name).toMatch(/^build-/);
    }
    expect(workflow).toMatch(/pattern: build-\*\n\s+path: dist\n\s+merge-multiple: true/);
  });

  it('dry-runs on pull requests that change a script the release runs', () => {
    const scripts = new Set([...workflow.matchAll(/node scripts\/([\w-]+\.js)/g)].map((match) => match[1]));
    // release-assets.js is required from inline node -e calls rather than run.
    scripts.add('release-assets.js');

    expect(scripts.size).toBeGreaterThan(3);
    for (const script of scripts) {
      expect(workflow, `${script} is run but not in the pull_request paths`).toContain(
        `      - scripts/${script}`
      );
    }
  });

  it('waits for the CI workflow that exists', () => {
    expect(workflow).toContain('--workflow ci.yml');
    expect(fs.existsSync(fromAppRoot('.github', 'workflows', 'ci.yml'))).toBe(true);
  });

  it('checks the installed Linux packages leave what the updater recognises them by', async () => {
    // The app tells a .deb and an .rpm install apart by the package manager's
    // records. If those move, the install jobs are where it shows.
    const { DPKG_FILE_LIST, LINUX_PACKAGE_NAME, RPM_DATABASES } = await import(
      '../src/main/update/install-target'
    );

    expect(DPKG_FILE_LIST.replace(LINUX_PACKAGE_NAME, '$EXECUTABLE')).toBe('/var/lib/dpkg/info/$EXECUTABLE.list');
    expect(workflow).toContain('/var/lib/dpkg/info/$EXECUTABLE.list');
    for (const database of RPM_DATABASES) {
      expect(workflow).toContain(`-d ${database} `);
    }
    expect(workflow).toMatch(/needs: \[plan, ci, windows, macos, linux, linux-install\]/);
  });

  it('uploads with a replace that the upload script confines to drafts', () => {
    expect(workflow).toContain('upload-release-assets.js --tag "$TAG" --repo "$GITHUB_REPOSITORY" --no-changelog --clobber');
  });
});
