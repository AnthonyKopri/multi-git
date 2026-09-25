// Privacy scan shared by `npm run check` and the capture pipeline: no private
// keys, no container paths, no Windows drive paths, no e-mail addresses
// outside the spec's fictional cast. Markdown docs are exempt (they describe
// these rules). Binary files are skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CAST_EMAILS = ['jane@example.com', 'jane@acme.example', 'sam@acme.example', 'priya@acme.example'];
const TEXT = new Set(['.json', '.html', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.txt', '.svg', '.xml', '.csv']);
const host = os.hostname();
const RULES = [
  ['private key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
  ['container path', /\/root\/|\/tmp\/|\/workspace\/|\/home\/user\//],
  ['Windows drive path', /(?<![A-Za-z0-9])[A-Z]:\\{1,2}[A-Za-z]/],
  ...(host && host.length >= 6 && host !== 'localhost' ? [['container hostname', new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]] : []),
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Addresses that ship in the app's own markup (placeholder copy such as
// jane@work.com) are product copy, not personal data.
const APP_MARKUP = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'public', 'index.html');
const APP_EMAILS = fs.existsSync(APP_MARKUP) ? new Set(fs.readFileSync(APP_MARKUP, 'utf8').match(EMAIL) ?? []) : new Set();

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== 'tmp') yield* walk(p); }
    else yield p;
  }
}

export function scanPrivacy(dirs) {
  const findings = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.md' || !TEXT.has(ext)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const [name, re] of RULES) {
        const m = re.exec(text);
        if (m) findings.push(`${name}: ${path.relative(process.cwd(), file)}: …${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}…`);
      }
      for (const m of text.matchAll(EMAIL)) {
        const addr = m[0];
        if (CAST_EMAILS.includes(addr) || APP_EMAILS.has(addr) || addr.startsWith('git@')) continue;
        findings.push(`e-mail outside the cast: ${path.relative(process.cwd(), file)}: ${addr}`);
      }
    }
  }
  return findings;
}
