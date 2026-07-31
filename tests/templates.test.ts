// Ported from the "templates" check in scripts/check.js, with the token-map
// assertions made per-template rather than aggregated.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { templatesDir } from '../src/server/app-root';
import { GITIGNORES, LICENSES, listGitignores, listLicenses } from '../src/server/templates/catalogue';
import {
  CUSTOM_GITIGNORE_STARTER,
  renderGitignore,
  renderLicense,
  sanitizePlaceholderValue
} from '../src/server/templates/render';

describe('the license catalogue', () => {
  it('offers licenses', () => {
    expect(listLicenses().length).toBeGreaterThan(0);
  });

  it('derives the client-facing field list from the token map', () => {
    const summaries = new Map(listLicenses().map((entry) => [entry.id, entry]));

    for (const license of LICENSES) {
      expect(summaries.get(license.id)?.fields).toEqual(Object.keys(license.tokens));
    }
  });

  it.each(LICENSES.map((license) => [license.id, license] as const))(
    'renders %s with every declared placeholder substituted',
    (id, license) => {
      const text = renderLicense(id, { year: '2026', holder: 'Example Holder' });

      expect(text.trim().length).toBeGreaterThan(200);

      // A declared placeholder that survives rendering means the token in the
      // catalogue no longer matches the token in the template file.
      for (const [field, tokens] of Object.entries(license.tokens)) {
        const expected = field === 'year' ? '2026' : 'Example Holder';
        expect(text, `${id} did not substitute ${field}`).toContain(expected);

        for (const token of tokens ?? []) {
          expect(text, `${id} still contains the raw token ${token}`).not.toContain(token);
        }
      }
    }
  );

  it('leaves a license with no placeholders byte-identical to its source file', () => {
    const verbatim = LICENSES.filter((license) => Object.keys(license.tokens).length === 0);
    expect(verbatim.length).toBeGreaterThan(0);

    for (const license of verbatim) {
      const source = fs.readFileSync(path.join(templatesDir(), 'licenses', license.file), 'utf8');
      expect(renderLicense(license.id), license.id).toBe(source);
    }
  });

  it('rejects an unknown license id', () => {
    expect(() => renderLicense('not-a-license')).toThrow(/Unknown license template/);
  });
});

describe('the .gitignore catalogue', () => {
  it('offers templates', () => {
    expect(listGitignores().length).toBeGreaterThan(0);
  });

  it.each(GITIGNORES.map((entry) => [entry.id] as const))('renders %s non-empty', (id) => {
    expect(renderGitignore(id).trim().length).toBeGreaterThan(0);
  });

  it('returns the commented starter for the custom choice', () => {
    expect(renderGitignore('custom')).toBe(CUSTOM_GITIGNORE_STARTER);
    expect(CUSTOM_GITIGNORE_STARTER.trim().length).toBeGreaterThan(0);
  });

  it('rejects an unknown template id', () => {
    expect(() => renderGitignore('not-a-template')).toThrow(/Unknown .gitignore template/);
  });
});

describe('sanitizePlaceholderValue', () => {
  it('keeps ordinary names intact', () => {
    expect(sanitizePlaceholderValue('Jane Doe')).toBe('Jane Doe');
  });

  it('strips control characters that would break the license layout', () => {
    const withNewline = `Jane${String.fromCharCode(10)}Doe`;
    expect(sanitizePlaceholderValue(withNewline)).toBe('Jane Doe');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(sanitizePlaceholderValue('  Jane    Doe  ')).toBe('Jane Doe');
  });

  it('caps the length', () => {
    expect(sanitizePlaceholderValue('x'.repeat(500))).toHaveLength(200);
  });

  it('treats absent values as empty', () => {
    expect(sanitizePlaceholderValue(undefined)).toBe('');
    expect(sanitizePlaceholderValue(null)).toBe('');
  });

  it('is applied when rendering, so a pasted multi-line holder cannot break the file', () => {
    const text = renderLicense('mit', {
      year: '2026',
      holder: `Evil${String.fromCharCode(10)}Newline`
    });

    expect(text).toContain('Evil Newline');
  });
});
