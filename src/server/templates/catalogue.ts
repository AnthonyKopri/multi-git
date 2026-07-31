// Premade LICENSE and .gitignore templates for the new-repository wizard.
//
// The template bodies live as plain files under templates/ rather than as
// string literals so they stay byte-identical to their upstream sources
// (choosealicense.com for licenses, github/gitignore for ignore files).
import type { GitignoreSummary, LicenseField, LicenseSummary } from '../../shared/template-types';

export interface LicenseTemplate {
  id: string;
  name: string;
  summary: string;
  file: string;
  /**
   * Placeholder tokens are not consistent across license families, so every
   * entry spells out the exact tokens its own text uses. A license with no
   * tokens is copied verbatim and its placeholder inputs stay hidden.
   */
  tokens: Partial<Record<LicenseField, string[]>>;
}

export interface GitignoreTemplate {
  id: string;
  name: string;
  file: string;
}

export const LICENSES: readonly LicenseTemplate[] = [
  {
    id: 'mit',
    name: 'MIT License',
    summary: 'Short and permissive. Keeps the copyright notice, no warranty.',
    file: 'mit.txt',
    tokens: { year: ['[year]'], holder: ['[fullname]'] }
  },
  {
    id: 'apache-2.0',
    name: 'Apache License 2.0',
    summary: 'Permissive with an explicit patent grant and change notices.',
    file: 'apache-2.0.txt',
    tokens: { year: ['[yyyy]'], holder: ['[name of copyright owner]'] }
  },
  {
    id: 'gpl-3.0',
    name: 'GNU GPL v3.0',
    summary: 'Strong copyleft: derived work must ship under the same license.',
    file: 'gpl-3.0.txt',
    tokens: {}
  },
  {
    id: 'agpl-3.0',
    name: 'GNU AGPL v3.0',
    summary: 'GPL v3 extended to cover software offered over a network.',
    file: 'agpl-3.0.txt',
    tokens: {}
  },
  {
    id: 'lgpl-3.0',
    name: 'GNU LGPL v3.0',
    summary: 'Copyleft for the library itself; linking stays unrestricted.',
    file: 'lgpl-3.0.txt',
    tokens: {}
  },
  {
    id: 'mpl-2.0',
    name: 'Mozilla Public License 2.0',
    summary: 'File-level copyleft that mixes with proprietary code.',
    file: 'mpl-2.0.txt',
    tokens: {}
  },
  {
    id: 'bsd-3-clause',
    name: 'BSD 3-Clause License',
    summary: 'Permissive, and forbids endorsement using your name.',
    file: 'bsd-3-clause.txt',
    tokens: { year: ['[year]'], holder: ['[fullname]'] }
  },
  {
    id: 'bsd-2-clause',
    name: 'BSD 2-Clause License',
    summary: 'Permissive and close to MIT, without the endorsement clause.',
    file: 'bsd-2-clause.txt',
    tokens: { year: ['[year]'], holder: ['[fullname]'] }
  },
  {
    id: 'isc',
    name: 'ISC License',
    summary: 'Functionally the same as MIT with less legacy wording.',
    file: 'isc.txt',
    tokens: { year: ['[year]'], holder: ['[fullname]'] }
  },
  {
    id: 'unlicense',
    name: 'The Unlicense',
    summary: 'Releases the work into the public domain.',
    file: 'unlicense.txt',
    tokens: {}
  }
];

export const GITIGNORES: readonly GitignoreTemplate[] = [
  { id: 'general', name: 'General (OS files, editors, build output)', file: 'general.gitignore' },
  { id: 'node', name: 'Node / JavaScript', file: 'node.gitignore' },
  { id: 'python', name: 'Python', file: 'python.gitignore' },
  { id: 'rust', name: 'Rust', file: 'rust.gitignore' },
  { id: 'go', name: 'Go', file: 'go.gitignore' },
  { id: 'java', name: 'Java', file: 'java.gitignore' },
  { id: 'cpp', name: 'C / C++', file: 'cpp.gitignore' },
  { id: 'dotnet', name: 'C# / .NET (Visual Studio)', file: 'dotnet.gitignore' },
  { id: 'unity', name: 'Unity', file: 'unity.gitignore' },
  { id: 'unreal', name: 'Unreal Engine', file: 'unreal.gitignore' },
  { id: 'godot', name: 'Godot', file: 'godot.gitignore' }
];

export function findLicense(id: string): LicenseTemplate | null {
  return LICENSES.find((license) => license.id === id) ?? null;
}

export function findGitignore(id: string): GitignoreTemplate | null {
  return GITIGNORES.find((entry) => entry.id === id) ?? null;
}

/**
 * Client-facing catalogue. Which placeholder inputs a license needs is derived
 * from its token map, so the two can never drift apart.
 */
export function listLicenses(): LicenseSummary[] {
  return LICENSES.map((license) => ({
    id: license.id,
    name: license.name,
    summary: license.summary,
    fields: Object.keys(license.tokens) as LicenseField[]
  }));
}

export function listGitignores(): GitignoreSummary[] {
  return GITIGNORES.map((entry) => ({ id: entry.id, name: entry.name }));
}
