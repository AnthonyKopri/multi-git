// Pre-release checks. Run with `npm test`.
//
// This project has no unit-test suite; these are the cheap, deterministic
// checks that catch the mistakes that actually ship broken builds: a file
// that does not parse, a template the wizard offers but cannot read, an
// element id the client looks up but the HTML never defines, and a source
// file missing from the Electron Builder file list.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const failures = [];
const notes = [];

function fail(check, message) {
  failures.push(`${check}: ${message}`);
}

function report(check, detail) {
  notes.push(`  ${check.padEnd(28)} ${detail}`);
}

// ---------- 1. every shipped script parses ----------
function checkSyntax() {
  const files = [
    'main.js',
    'preload.js',
    'server.js',
    'ssh-config.js',
    'repo-templates.js',
    'public/app.js',
    'scripts/after-pack.js',
    'scripts/check.js',
    'scripts/release.js'
  ].filter((file) => fs.existsSync(path.join(ROOT, file)));

  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
    } catch (err) {
      fail('syntax', `${file} does not parse\n${(err.stderr || '').toString().trim()}`);
    }
  }

  report('syntax', `${files.length} files parsed`);
}

// ---------- 2. every offered template is readable and renders ----------
function checkTemplates() {
  const templates = require(path.join(ROOT, 'repo-templates.js'));
  const licenses = templates.listLicenses();
  const gitignores = templates.listGitignores();

  if (licenses.length === 0) fail('templates', 'no licenses in the catalogue');
  if (gitignores.length === 0) fail('templates', 'no .gitignore templates in the catalogue');

  for (const license of licenses) {
    let text;
    try {
      text = templates.renderLicense(license.id, { year: '2026', holder: 'Example Holder' });
    } catch (err) {
      fail('templates', `license "${license.id}" failed to render: ${err.message}`);
      continue;
    }

    if (text.trim().length < 200) {
      fail('templates', `license "${license.id}" rendered suspiciously short (${text.length} chars)`);
    }
    // A declared placeholder that survives rendering means the token in the
    // catalogue no longer matches the token in the template file.
    if (license.fields.includes('holder') && !text.includes('Example Holder')) {
      fail('templates', `license "${license.id}" declares a holder field but the value was not substituted`);
    }
    if (license.fields.includes('year') && !text.includes('2026')) {
      fail('templates', `license "${license.id}" declares a year field but the value was not substituted`);
    }
  }

  for (const entry of gitignores) {
    try {
      if (templates.renderGitignore(entry.id).trim().length === 0) {
        fail('templates', `.gitignore template "${entry.id}" is empty`);
      }
    } catch (err) {
      fail('templates', `.gitignore template "${entry.id}" failed to read: ${err.message}`);
    }
  }

  if (templates.renderGitignore('custom').trim().length === 0) {
    fail('templates', 'the custom .gitignore starter is empty');
  }

  report('templates', `${licenses.length} licenses, ${gitignores.length} .gitignore templates`);
}

// ---------- 3. every id app.js looks up exists in index.html ----------
function checkElementIds() {
  const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

  const definedIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  );
  const lookedUpIds = new Set(
    [...appJs.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1])
  );

  const missing = [...lookedUpIds].filter((id) => !definedIds.has(id));
  if (missing.length > 0) {
    fail('element-ids', `app.js looks up ids that index.html does not define: ${missing.join(', ')}`);
  }

  report('element-ids', `${lookedUpIds.size} lookups resolved`);
}

// ---------- 4. everything the app needs at runtime is packaged ----------
function checkPackagedFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packaged = (pkg.build && pkg.build.files) || [];

  const required = [
    'main.js',
    'preload.js',
    'server.js',
    'ssh-config.js',
    'repo-templates.js',
    'package.json',
    'public/**/*',
    'templates/**/*'
  ];

  const missing = required.filter((entry) => !packaged.includes(entry));
  if (missing.length > 0) {
    fail('packaging', `package.json build.files is missing: ${missing.join(', ')}`);
  }

  if (!/^\d+\.\d+\.\d+/.test(pkg.version || '')) {
    fail('packaging', `version "${pkg.version}" is not a semantic version`);
  }

  report('packaging', `version ${pkg.version}, ${packaged.length} file globs`);
}

checkSyntax();
checkTemplates();
checkElementIds();
checkPackagedFiles();

console.log(notes.join('\n'));

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log('\nAll checks passed.');
