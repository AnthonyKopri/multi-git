import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import { runGitCommand } from '../git/run';
import { createGithubRepository, detectGithubCli } from '../external/github-cli';
import type { RepoVisibility } from '../external/github-cli';
import { findGitignore, findLicense, listGitignores, listLicenses } from '../templates/catalogue';
import { renderGitignore, renderLicense, sanitizePlaceholderValue } from '../templates/render';
import { resolveNewRepoTarget } from '../middleware/repo-path';
import { HttpError, asyncRoute } from '../middleware/error-handler';

export const newRepoRouter: Router = Router();

/**
 * Any of these counts as "this folder already has a license", so the wizard
 * asks before overwriting one the user wrote themselves.
 */
const LICENSE_FILE_PATTERN = /^(LICENSE|LICENCE|COPYING)(\.[A-Za-z0-9]+)?$/i;
const LICENSE_YEAR_PATTERN = /^[0-9]{4}(\s*-\s*[0-9]{4})?$/;

function findExistingLicenseFile(folder: string): string | null {
  try {
    return (
      fs
        .readdirSync(folder, { withFileTypes: true })
        .find((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))?.name ?? null
    );
  } catch {
    return null;
  }
}

newRepoRouter.get('/api/repo-templates', (_req, res) => {
  res.json({ success: true, licenses: listLicenses(), gitignores: listGitignores() });
});

newRepoRouter.get(
  '/api/github/cli-status',
  asyncRoute(async (req, res) => {
    // The wizard opens often; detection is cached unless explicitly refreshed.
    const forceRefresh = req.query['refresh'] === '1';
    res.json({ success: true, ...(await detectGithubCli(forceRefresh)) });
  })
);

newRepoRouter.post(
  '/api/git/new-repo/preflight',
  asyncRoute((req, res) => {
    const resolved = resolveNewRepoTarget((req.body as { repoPath?: unknown })?.repoPath);
    const exists = fs.existsSync(resolved);

    if (!exists) {
      res.json({
        success: true,
        repoPath: resolved,
        folderExists: false,
        isDirectory: false,
        isGitRepo: false,
        isEmpty: true,
        existingLicense: null,
        existingGitignore: false
      });
      return;
    }

    res.json({
      success: true,
      repoPath: resolved,
      folderExists: true,
      isDirectory: true,
      isGitRepo: fs.existsSync(path.join(resolved, '.git')),
      isEmpty: fs.readdirSync(resolved).length === 0,
      existingLicense: findExistingLicenseFile(resolved),
      existingGitignore: fs.existsSync(path.join(resolved, '.gitignore'))
    });
  })
);

newRepoRouter.post(
  '/api/git/new-repo',
  asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const visibility = (body['visibility'] ?? 'private') as RepoVisibility;
    const licenseId = String(body['licenseId'] ?? 'none');
    const gitignoreId = String(body['gitignoreId'] ?? 'none');
    const replaceLicense = Boolean(body['replaceLicense']);
    const replaceGitignore = Boolean(body['replaceGitignore']);
    const createRemote = Boolean(body['createRemote']);
    const useSshRemote = body['useSshRemote'] !== false;

    const resolved = resolveNewRepoTarget(body['repoPath']);

    if (visibility !== 'private' && visibility !== 'public') {
      throw new HttpError('Visibility must be either private or public.', 400);
    }

    const license = licenseId !== 'none' ? findLicense(licenseId) : null;
    if (licenseId !== 'none' && !license) {
      throw new HttpError(`Unknown license template: ${licenseId}`, 400);
    }

    const wantsGitignore = Boolean(gitignoreId) && gitignoreId !== 'none';
    const isCustomGitignore = gitignoreId === 'custom';
    if (wantsGitignore && !isCustomGitignore && !findGitignore(gitignoreId)) {
      throw new HttpError(`Unknown .gitignore template: ${gitignoreId}`, 400);
    }

    const holder = sanitizePlaceholderValue(body['licenseHolder']);
    const year =
      sanitizePlaceholderValue(body['licenseYear']) || String(new Date().getFullYear());

    if (license?.tokens.holder && !holder) {
      throw new HttpError(`The ${license.name} template needs a copyright holder name.`, 400);
    }
    if (license?.tokens.year && !LICENSE_YEAR_PATTERN.test(year)) {
      throw new HttpError(
        'Copyright year must be a four digit year, optionally a range such as 2023-2026.',
        400
      );
    }

    if (fs.existsSync(path.join(resolved, '.git'))) {
      throw new HttpError('A Git repository already exists in this folder', 400);
    }

    const steps: string[] = [];
    const warnings: string[] = [];

    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
      steps.push(`Created folder ${resolved}`);
    }

    await runGitCommand(resolved, ['init']);
    steps.push('Initialised an empty Git repository');

    let licenseFile: string | null = null;
    if (license) {
      const existing = findExistingLicenseFile(resolved);
      if (existing && !replaceLicense) {
        warnings.push(`Kept the existing ${existing}; the ${license.name} template was not written.`);
      } else {
        licenseFile = existing ?? 'LICENSE';
        fs.writeFileSync(
          path.join(resolved, licenseFile),
          renderLicense(license.id, { year, holder }),
          'utf8'
        );
        steps.push(`${existing ? 'Replaced' : 'Added'} ${licenseFile} (${license.name})`);
      }
    }

    let gitignoreWritten = false;
    if (wantsGitignore) {
      const gitignorePath = path.join(resolved, '.gitignore');
      const existed = fs.existsSync(gitignorePath);

      if (existed && !replaceGitignore) {
        warnings.push(
          isCustomGitignore
            ? 'Kept the existing .gitignore and opened it for editing.'
            : 'Kept the existing .gitignore; the selected template was not written.'
        );
      } else {
        fs.writeFileSync(gitignorePath, renderGitignore(gitignoreId), 'utf8');
        gitignoreWritten = true;
        steps.push(`${existed ? 'Replaced' : 'Added'} .gitignore`);
      }
    }

    let remote = null;
    if (createRemote) {
      // Never throws: a remote failure must not invalidate the local
      // repository that now exists on disk.
      const result = await createGithubRepository({
        repoPath: resolved,
        visibility,
        useSshRemote
      });

      if ('error' in result) {
        warnings.push(result.error);
      } else {
        remote = result;
        steps.push(`Created ${visibility} GitHub repository ${result.name} and set origin`);
      }
    }

    res.json({
      success: true,
      repoPath: resolved,
      visibility,
      licenseFile,
      gitignoreWritten,
      // Custom always ends in the editor, including when an existing
      // .gitignore was kept: the point of the choice is to edit it.
      openCustomGitignore: isCustomGitignore,
      remote,
      steps,
      warnings
    });
  })
);
