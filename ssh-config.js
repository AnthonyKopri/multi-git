// Maintains a clearly-marked managed block inside the user's ~/.ssh/config so
// external tools (Git Bash, plain `git`, IDEs) pick up the same key that is
// active in Multi-Git. Only the text between the BEGIN/END markers is ever
// touched; everything the user wrote stays byte-identical.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MARK_BEGIN = '# BEGIN multi-git managed block (do not edit inside)';
const MARK_END = '# END multi-git managed block';

function getSshDir() {
  return path.join(os.homedir(), '.ssh');
}

function getSshConfigPath() {
  return path.join(getSshDir(), 'config');
}

// hostsMap: { 'github.com': 'C:\\Users\\x\\.ssh\\id_ed25519_work', ... }
function renderManagedBlock(hostsMap) {
  const lines = [MARK_BEGIN];
  for (const host of Object.keys(hostsMap).sort()) {
    const keyPath = String(hostsMap[host]).replace(/\\/g, '/');
    lines.push(`Host ${host}`);
    lines.push(`  HostName ${host}`);
    lines.push(`  IdentityFile "${keyPath}"`);
    lines.push('  IdentitiesOnly yes');
  }
  lines.push(MARK_END);
  return lines.join('\n');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces (or removes, when hostsMap is empty) the managed block, creating
// ~/.ssh and the config file when missing. The block always lives at the TOP
// of the file: OpenSSH options are first-match-wins, so this is the only
// placement that guarantees the active key actually wins over pre-existing
// user Host entries (users who don't want that use the in-app opt-out).
// Returns { changed, warning }.
function applyManagedBlock(hostsMap) {
  const sshDir = getSshDir();
  const configPath = getSshConfigPath();

  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }

  let content = '';
  let fileExisted = false;
  if (fs.existsSync(configPath)) {
    fileExisted = true;
    content = fs.readFileSync(configPath, 'utf8');
  }

  const wantBlock = Object.keys(hostsMap).length > 0;
  const block = wantBlock ? renderManagedBlock(hostsMap) : '';
  const blockRegex = new RegExp(
    `${escapeRegExp(MARK_BEGIN)}[\\s\\S]*?${escapeRegExp(MARK_END)}\\n?`
  );

  let warning = null;
  const hasBegin = content.includes(MARK_BEGIN);
  const hasEnd = content.includes(MARK_END);

  // Strip the current block (wherever it is), leaving user content untouched
  let remainder = content;
  if (hasBegin && hasEnd && blockRegex.test(content)) {
    remainder = content.replace(blockRegex, '').replace(/\n{3,}/g, '\n\n');
  } else if (hasBegin || hasEnd) {
    // Corrupted block (one marker missing): never guess at boundaries.
    warning = 'Found an incomplete multi-git block in ~/.ssh/config; left it in place and wrote a fresh block at the top.';
  } else if (!wantBlock) {
    return { changed: false, warning: null }; // nothing to remove
  }
  remainder = remainder.replace(/^\n+/, '');

  let next;
  if (!wantBlock) {
    next = remainder.trim() === '' ? '' : remainder;
  } else if (remainder === '') {
    next = `${block}\n`;
  } else {
    next = `${block}\n\n${remainder}`;
  }

  if (next === content) {
    return { changed: false, warning };
  }

  // Atomic write so a crash cannot leave a half-written ssh config
  const tempPath = `${configPath}.multi-git-tmp`;
  fs.writeFileSync(tempPath, next, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, configPath);

  if (!fileExisted && process.platform !== 'win32') {
    fs.chmodSync(configPath, 0o600);
  }

  return { changed: true, warning };
}

function removeManagedBlock() {
  return applyManagedBlock({});
}

module.exports = {
  MARK_BEGIN,
  MARK_END,
  getSshConfigPath,
  renderManagedBlock,
  applyManagedBlock,
  removeManagedBlock
};
