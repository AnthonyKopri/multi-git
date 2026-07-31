// Reads template bodies from disk and substitutes license placeholders.
import fs from 'node:fs';
import path from 'node:path';

import { templatesDir } from '../app-root';
import { findGitignore, findLicense } from './catalogue';
import type { LicenseValues } from '../../shared/template-types';

/**
 * Starting point for the "Custom" choice: the file is created so the editor
 * has something to open, and the comments explain the syntax.
 */
export const CUSTOM_GITIGNORE_STARTER = [
  '# Custom .gitignore',
  '#',
  '# One pattern per line. Lines starting with # are comments.',
  '#   build/        ignore a folder anywhere in the repository',
  '#   /dist         ignore a folder in the repository root only',
  '#   *.log         ignore every file with this extension',
  '#   !keep.log     keep a file an earlier pattern would have ignored',
  ''
].join('\n');

function readTemplateFile(subdirectory: string, fileName: string): string {
  return fs.readFileSync(path.join(templatesDir(), subdirectory, fileName), 'utf8');
}

/**
 * Placeholder values are pure file content and never reach a shell, but
 * control characters are still dropped so a pasted value cannot break the
 * line layout of the rendered license.
 */
export function sanitizePlaceholderValue(value: unknown): string {
  return String(value ?? '')
    .replace(/\p{C}/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
}

export function renderLicense(id: string, values: LicenseValues = {}): string {
  const license = findLicense(id);
  if (!license) {
    throw new Error(`Unknown license template: ${id}`);
  }

  let text = readTemplateFile('licenses', license.file);

  for (const [field, tokens] of Object.entries(license.tokens)) {
    const replacement = sanitizePlaceholderValue(values[field as keyof LicenseValues]);
    for (const token of tokens ?? []) {
      text = text.split(token).join(replacement);
    }
  }

  return text;
}

export function renderGitignore(id: string): string {
  if (id === 'custom') {
    return CUSTOM_GITIGNORE_STARTER;
  }

  const entry = findGitignore(id);
  if (!entry) {
    throw new Error(`Unknown .gitignore template: ${id}`);
  }

  return readTemplateFile('gitignore', entry.file);
}
