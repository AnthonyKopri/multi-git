const express = require('express');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// The API executes git and filesystem operations on behalf of the local UI
// only. Reject requests whose Host/Origin is not localhost so remote hosts
// and cross-site pages (CSRF) cannot drive it, and bind to 127.0.0.1 below.
function isLocalhostValue(value) {
  if (!value) {
    return true;
  }
  const host = String(value).replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

app.use((req, res, next) => {
  if (!isLocalhostValue(req.headers.host) || !isLocalhostValue(req.headers.origin)) {
    return res.status(403).json({ error: 'Requests are only accepted from localhost.' });
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Path to the config file stored in the user's home directory
const CONFIG_FILE = path.join(os.homedir(), '.multi-git-client-config.json');
const SECRETS_FILE = path.join(os.homedir(), '.multi-git-client-secrets.json');
let vaultKey = null;

// Helper to read config
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading config:', err);
  }
  return { recentRepos: [], sshProfiles: [] };
}

// Helper to write config
function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing config:', err);
    return false;
  }
}

function readSecretsFile() {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      const data = fs.readFileSync(SECRETS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading secrets file:', err);
  }

  return null;
}

function writeSecretsFile(vault) {
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(vault, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing secrets file:', err);
    return false;
  }
}

function getVaultStatus() {
  return {
    hasVault: fs.existsSync(SECRETS_FILE),
    unlocked: Boolean(vaultKey)
  };
}

function deriveVaultKey(masterKey, saltHex) {
  return crypto.scryptSync(masterKey, Buffer.from(saltHex, 'hex'), 32);
}

function encryptWithVaultKey(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex')
  };
}

function decryptWithVaultKey(payload, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

function ensureVaultShape(vault) {
  if (!vault.passphrases || typeof vault.passphrases !== 'object') {
    vault.passphrases = {};
  }

  return vault;
}

function initializeVault(masterKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = deriveVaultKey(masterKey, salt);
  const vault = {
    version: 1,
    salt,
    check: encryptWithVaultKey('multi-git-vault-check', derivedKey),
    passphrases: {}
  };

  if (!writeSecretsFile(vault)) {
    throw new Error('Failed to initialize secrets vault');
  }

  vaultKey = derivedKey;
}

function unlockVault(masterKey) {
  const vault = readSecretsFile();
  if (!vault) {
    initializeVault(masterKey);
    return;
  }

  if (!vault.salt || !vault.check) {
    throw new Error('Vault file is corrupted');
  }

  const candidateKey = deriveVaultKey(masterKey, vault.salt);
  let check;
  try {
    check = decryptWithVaultKey(vault.check, candidateKey);
  } catch (err) {
    throw new Error('Invalid master key');
  }

  if (check !== 'multi-git-vault-check') {
    throw new Error('Invalid master key');
  }

  vaultKey = candidateKey;
}

function setStoredPassphrase(profileId, passphrase) {
  if (!vaultKey) {
    throw new Error('Vault is locked');
  }

  const existing = ensureVaultShape(readSecretsFile() || {});
  existing.passphrases[profileId] = encryptWithVaultKey(passphrase, vaultKey);

  if (!writeSecretsFile(existing)) {
    throw new Error('Failed to write passphrase vault');
  }
}

function removeStoredPassphrase(profileId) {
  const existing = readSecretsFile();
  if (!existing) {
    return;
  }

  const vault = ensureVaultShape(existing);
  if (vault.passphrases[profileId]) {
    delete vault.passphrases[profileId];
    writeSecretsFile(vault);
  }
}

function getStoredPassphrase(profileId) {
  if (!vaultKey) {
    return null;
  }

  const existing = readSecretsFile();
  if (!existing) {
    return null;
  }

  const vault = ensureVaultShape(existing);
  const encrypted = vault.passphrases[profileId];
  if (!encrypted) {
    return null;
  }

  try {
    return decryptWithVaultKey(encrypted, vaultKey);
  } catch (err) {
    return null;
  }
}

function hasStoredPassphrase(profileId) {
  const existing = readSecretsFile();
  if (!existing) {
    return false;
  }

  const vault = ensureVaultShape(existing);
  return Boolean(vault.passphrases[profileId]);
}

function sanitizeConfigForClient(config) {
  const vault = readSecretsFile();
  const savedPassphraseIds = new Set(Object.keys((vault && vault.passphrases) || {}));

  return {
    recentRepos: config.recentRepos || [],
    sshProfiles: (config.sshProfiles || []).map((profile) => ({
      ...profile,
      hasSavedPassword: savedPassphraseIds.has(profile.id)
    })),
    accountRules: config.accountRules || [],
    vaultStatus: getVaultStatus()
  };
}

function validateSshKeyPair(privateKeyPath, passphrase = '') {
  return new Promise((resolve) => {
    const args = ['-y', '-f', privateKeyPath, '-P', passphrase];
    const child = spawn('ssh-keygen', args, {
      shell: false,
      windowsHide: true
    });

    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        valid: false,
        message: 'SSH key validation timed out'
      });
    }, 15000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        valid: false,
        message: `ssh-keygen execution error: ${err.message}`
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          valid: true,
          message: 'SSH key and passphrase are valid'
        });
      } else {
        const message = stderr.trim() || stdout.trim() || 'SSH key validation failed';
        resolve({ valid: false, message });
      }
    });
  });
}

function generateSshKeyPair({ privateKeyPath, keyType = 'ed25519', passphrase = '', comment = '' }) {
  return new Promise((resolve, reject) => {
    const args = ['-t', keyType, '-f', privateKeyPath, '-N', passphrase || ''];
    if (keyType === 'rsa') {
      args.push('-b', '4096');
    }
    if (comment) {
      args.push('-C', comment);
    }

    const child = spawn('ssh-keygen', args, {
      shell: false,
      windowsHide: true
    });

    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('SSH key generation timed out'));
    }, 30000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ssh-keygen execution error: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || 'SSH key generation failed'));
      }
    });
  });
}

// Resolve a repo-relative file path and guarantee the result stays inside
// the repository root (blocks "../" escapes and absolute paths).
function resolveInsideRepo(repoPath, filePath) {
  const repoRoot = path.resolve(repoPath);
  const fullPath = path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, fullPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return fullPath;
}

function normalizeSshPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return '';
  }

  return path.resolve(targetPath.replace(/~/g, os.homedir()));
}

function sanitizeLabelForKeyName(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function buildUniqueKeyBaseName(sshDir, requestedBaseName) {
  let candidate = requestedBaseName;
  let index = 1;

  while (
    fs.existsSync(path.join(sshDir, candidate)) ||
    fs.existsSync(path.join(sshDir, `${candidate}.pub`))
  ) {
    index += 1;
    candidate = `${requestedBaseName}_${index}`;
  }

  return candidate;
}

function openPathInFileExplorer(targetPath) {
  return new Promise((resolve, reject) => {
    let command = '';
    let args = [];

    if (os.platform() === 'win32') {
      command = 'explorer';
      args = [targetPath];
    } else if (os.platform() === 'darwin') {
      command = 'open';
      args = [targetPath];
    } else {
      command = 'xdg-open';
      args = [targetPath];
    }

    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to open location: ${err.message}`));
    });

    child.unref();
    resolve(true);
  });
}

function buildSshCommand(sshKeyPath) {
  const normalizedPath = sshKeyPath.replace(/\\/g, '/');
  return `ssh -i "${normalizedPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o NumberOfPasswordPrompts=1`;
}

function createAskpassBridge(passphrase) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const isWindows = os.platform() === 'win32';
  const scriptPath = path.join(os.tmpdir(), `multi-git-askpass-${suffix}${isWindows ? '.cmd' : '.sh'}`);

  if (isWindows) {
    const escaped = String(passphrase)
      .replace(/%/g, '%%')
      .replace(/([&|<>()^])/g, '^$1');
    const script = `@echo off\r\nsetlocal DisableDelayedExpansion\r\necho ${escaped}\r\n`;
    fs.writeFileSync(scriptPath, script, 'utf8');
  } else {
    const escaped = String(passphrase).replace(/'/g, `'"'"'`);
    const script = `#!/bin/sh\necho '${escaped}'\n`;
    fs.writeFileSync(scriptPath, script, 'utf8');
    fs.chmodSync(scriptPath, 0o700);
  }

  const envOverrides = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: scriptPath,
    SSH_ASKPASS: scriptPath,
    DISPLAY: 'multi-git'
  };

  const cleanup = () => {
    try {
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    } catch (err) {
      console.warn('Failed to cleanup askpass bridge:', err.message);
    }
  };

  return { envOverrides, cleanup };
}

// Helper to execute git command
function runGitCommand(repoPath, args, sshKeyPath = null, options = {}) {
  return new Promise((resolve, reject) => {
    let env = { ...process.env, ...(options.envOverrides || {}) };
    if (options.customSshCommand) {
      env.GIT_SSH_COMMAND = options.customSshCommand;
    } else if (sshKeyPath) {
      const normalizedPath = sshKeyPath.replace(/\\/g, '/');
      env.GIT_SSH_COMMAND = `ssh -i "${normalizedPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
    }

    const child = spawn('git', args, {
      cwd: repoPath,
      env,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject({ error, stdout, stderr });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject({
          error: new Error(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`),
          stdout,
          stderr: stderr || `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`
        });
      } else if (code !== 0) {
        reject({ error: new Error(`git exited with code ${code}`), stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Git quotes paths containing special characters: "path \"x\".txt"
function unquoteGitPath(rawPath) {
  const trimmed = rawPath.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\([\\"tnr])/g, (m, ch) => ({ '\\': '\\', '"': '"', t: '\t', n: '\n', r: '\r' }[ch]));
  }
  return trimmed;
}

// Parse PORCELAIN git status
function parsePorcelainStatus(stdout) {
  const lines = stdout.split('\n');
  let branch = 'HEAD';
  let tracking = '';
  let ahead = 0;
  let behind = 0;
  let detached = false;
  let noCommits = false;
  const staged = [];
  const unstaged = [];
  const conflicts = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      // Header line, e.g. ## main...origin/main [ahead 1, behind 2]
      const header = line.substring(3).trim();

      // Edge cases: "## No commits yet on main" and "## HEAD (no branch)"
      const noCommitsMatch = header.match(/^No commits yet on (.+)$/);
      if (noCommitsMatch) {
        branch = noCommitsMatch[1];
        noCommits = true;
        continue;
      }
      if (header === 'HEAD (no branch)') {
        branch = '(detached)';
        detached = true;
        continue;
      }

      const parts = header.split('...');
      branch = parts[0] || 'HEAD';

      if (parts[1]) {
        // e.g. origin/main [ahead 1, behind 2] or origin/main
        const trackingParts = parts[1].split(' ');
        tracking = trackingParts[0];

        const trackingString = parts[1];
        const aheadMatch = trackingString.match(/ahead (\d+)/);
        const behindMatch = trackingString.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
      }
      continue;
    }

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    let filePath = unquoteGitPath(line.substring(3));
    let origPath = null;

    // Renames/copies list as "old -> new"; show the new path
    if ((indexStatus === 'R' || indexStatus === 'C') && filePath.includes(' -> ')) {
      const arrowParts = filePath.split(' -> ');
      origPath = unquoteGitPath(arrowParts[0]);
      filePath = unquoteGitPath(arrowParts[1]);
    }

    // Check for conflict codes
    // DD (both deleted), AU (added by us, deleted by them), UD (deleted by us, added by them), UA (added by them, deleted by us),
    // DU (deleted by us, modified by them), UD (modified by us, deleted by them), UU (both modified), AA (both added)
    const isConflict = 
      (indexStatus === 'U' || workTreeStatus === 'U') ||
      (indexStatus === 'A' && workTreeStatus === 'A') ||
      (indexStatus === 'D' && workTreeStatus === 'D');

    if (isConflict) {
      conflicts.push({
        path: filePath,
        status: `${indexStatus}${workTreeStatus}`
      });
    } else {
      // Staged status is in the first column
      if (indexStatus !== ' ' && indexStatus !== '?') {
        staged.push({ path: filePath, status: indexStatus, origPath });
      }
      // Unstaged status is in the second column
      if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
        unstaged.push({ path: filePath, status: workTreeStatus });
      } else if (indexStatus === '?') {
        // Untracked files have '?' in both columns (though porcelain shows '??')
        unstaged.push({ path: filePath, status: '?' });
      }
    }
  }

  return { branch, tracking, ahead, behind, detached, noCommits, staged, unstaged, conflicts };
}

function maybeOpenBrowser(url, enabled) {
  if (!enabled) {
    return;
  }

  let startCommand;
  if (os.platform() === 'win32') {
    startCommand = `start ${url}`;
  } else if (os.platform() === 'darwin') {
    startCommand = `open ${url}`;
  } else {
    startCommand = `xdg-open ${url}`;
  }

  exec(startCommand, (err) => {
    if (err) {
      console.log(`Please open your browser and navigate to: ${url}`);
    } else {
      console.log(`Browser automatically opened to: ${url}`);
    }
  });
}

// ----------------- CONFIG API -----------------

// Get application config (recent repositories and SSH profiles)
app.get('/api/config', (req, res) => {
  const config = readConfig();
  res.json(sanitizeConfigForClient(config));
});

app.get('/api/secrets/status', (req, res) => {
  res.json({ success: true, ...getVaultStatus() });
});

app.post('/api/secrets/unlock', (req, res) => {
  const { masterKey } = req.body;
  if (!masterKey || typeof masterKey !== 'string') {
    return res.status(400).json({ error: 'Master key is required' });
  }

  try {
    unlockVault(masterKey);
    res.json({ success: true, ...getVaultStatus() });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Failed to unlock vault' });
  }
});

app.post('/api/secrets/lock', (req, res) => {
  vaultKey = null;
  res.json({ success: true, ...getVaultStatus() });
});

// Add a repository to recent list
app.post('/api/config/repo', (req, res) => {
  const { repoPath } = req.body;
  if (!repoPath) {
    return res.status(400).json({ error: 'Repository path is required' });
  }

  try {
    const resolvedPath = path.resolve(repoPath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(400).json({ error: 'Directory does not exist' });
    }
    
    // Check if it's a git repo
    if (!fs.existsSync(path.join(resolvedPath, '.git'))) {
      return res.status(400).json({ error: 'Not a valid Git repository (missing .git folder)' });
    }

    const config = readConfig();
    config.recentRepos = config.recentRepos.filter(p => p !== resolvedPath);
    config.recentRepos.unshift(resolvedPath);
    // Keep max 15 recent repos
    if (config.recentRepos.length > 15) {
      config.recentRepos = config.recentRepos.slice(0, 15);
    }

    writeConfig(config);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a repository from recent list
app.delete('/api/config/repo', (req, res) => {
  const { repoPath } = req.body;
  const config = readConfig();
  config.recentRepos = config.recentRepos.filter(p => p !== repoPath);
  writeConfig(config);
  res.json({ success: true, config });
});

// Add or update an SSH profile (an "account": key + optional git identity)
app.post('/api/config/ssh', (req, res) => {
  const { id, label, privateKeyPath, keepPassword, passphrase, userName, userEmail } = req.body;
  if (!label || !privateKeyPath) {
    return res.status(400).json({ error: 'Label and Private Key Path are required' });
  }

  const resolvedKeyPath = path.resolve(privateKeyPath.replace(/~/g, os.homedir()));
  if (!fs.existsSync(resolvedKeyPath)) {
    return res.status(400).json({ error: `Private Key file not found at: ${resolvedKeyPath}` });
  }

  const config = readConfig();
  const profileId = id || Date.now().toString();
  const profileData = {
    id: profileId,
    label,
    privateKeyPath: resolvedKeyPath,
    userName: typeof userName === 'string' ? userName.trim() : '',
    userEmail: typeof userEmail === 'string' ? userEmail.trim() : ''
  };

  if (id) {
    // Update
    const idx = config.sshProfiles.findIndex(p => p.id === id);
    if (idx !== -1) {
      config.sshProfiles[idx] = profileData;
    } else {
      config.sshProfiles.push(profileData);
    }
  } else {
    // Insert new
    config.sshProfiles.push(profileData);
  }

  if (keepPassword) {
    if (!vaultKey) {
      return res.status(400).json({ error: 'Vault is locked. Unlock vault before saving passwords.' });
    }

    if (!passphrase || typeof passphrase !== 'string') {
      return res.status(400).json({ error: 'Passphrase is required when Keep Password is enabled.' });
    }

    try {
      setStoredPassphrase(profileId, passphrase);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to store passphrase securely.' });
    }
  } else {
    removeStoredPassphrase(profileId);
  }

  writeConfig(config);
  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

// Delete an SSH profile
app.delete('/api/config/ssh', (req, res) => {
  const { id } = req.body;
  const config = readConfig();
  config.sshProfiles = config.sshProfiles.filter(p => p.id !== id);
  // Drop auto-select rules pointing at the deleted account
  config.accountRules = (config.accountRules || []).filter(r => r.profileId !== id);
  removeStoredPassphrase(id);
  writeConfig(config);
  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

// ----------------- ACCOUNT AUTO-SELECT RULES -----------------
// Rules map a remote URL substring to an account, e.g. "github.com/work-org"
// -> Work profile. Evaluated by the client when a repository opens.

app.post('/api/config/account-rules', (req, res) => {
  const { match, profileId } = req.body || {};
  const safeMatch = typeof match === 'string' ? match.trim() : '';
  if (!safeMatch) {
    return res.status(400).json({ error: 'A match text is required (e.g. github.com/your-org).' });
  }

  const config = readConfig();
  if (!(config.sshProfiles || []).some(p => p.id === profileId)) {
    return res.status(400).json({ error: 'Selected account profile was not found.' });
  }

  config.accountRules = config.accountRules || [];
  config.accountRules.push({ id: Date.now().toString(), match: safeMatch, profileId });
  writeConfig(config);
  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

app.delete('/api/config/account-rules', (req, res) => {
  const { id } = req.body || {};
  const config = readConfig();
  config.accountRules = (config.accountRules || []).filter(r => r.id !== id);
  writeConfig(config);
  res.json({ success: true, config: sanitizeConfigForClient(config) });
});

app.post('/api/config/ssh/test', async (req, res) => {
  const { profileId, privateKeyPath, passphrase } = req.body;
  const config = readConfig();

  let resolvedKeyPath = '';
  let effectivePassphrase = typeof passphrase === 'string' ? passphrase : '';

  if (profileId) {
    const profile = (config.sshProfiles || []).find((item) => item.id === profileId);
    if (!profile) {
      return res.status(404).json({ error: 'SSH profile not found' });
    }

    resolvedKeyPath = profile.privateKeyPath;
    if (!effectivePassphrase) {
      const storedPassphrase = getStoredPassphrase(profileId);
      if (storedPassphrase) {
        effectivePassphrase = storedPassphrase;
      }
    }
  } else if (privateKeyPath) {
    resolvedKeyPath = path.resolve(privateKeyPath.replace(/~/g, os.homedir()));
  } else {
    return res.status(400).json({ error: 'Provide either profileId or privateKeyPath' });
  }

  if (!fs.existsSync(resolvedKeyPath)) {
    return res.status(400).json({ error: `Private key file not found at: ${resolvedKeyPath}` });
  }

  const result = await validateSshKeyPair(resolvedKeyPath, effectivePassphrase);
  res.json({
    success: result.valid,
    message: result.message,
    usedSavedPassword: Boolean(profileId && !passphrase && effectivePassphrase)
  });
});

app.post('/api/config/ssh/generate', async (req, res) => {
  const {
    label,
    keyType = 'ed25519',
    passphrase = '',
    keepPassword = false,
    keyName = '',
    userName = '',
    userEmail = ''
  } = req.body || {};

  const safeLabel = typeof label === 'string' ? label.trim() : '';
  if (!safeLabel) {
    return res.status(400).json({ error: 'Profile label is required' });
  }

  const normalizedType = String(keyType).toLowerCase();
  if (normalizedType !== 'ed25519' && normalizedType !== 'rsa') {
    return res.status(400).json({ error: 'Unsupported key type. Use ed25519 or rsa.' });
  }

  const normalizedPassphrase = typeof passphrase === 'string' ? passphrase : '';
  if (keepPassword && !vaultKey) {
    return res.status(400).json({ error: 'Vault is locked. Unlock vault before saving passwords.' });
  }

  if (keepPassword && !normalizedPassphrase) {
    return res.status(400).json({ error: 'Passphrase is required when Keep Password is enabled.' });
  }

  const sanitizedKeyName = typeof keyName === 'string' ? keyName.trim() : '';
  if (sanitizedKeyName && !/^[a-zA-Z0-9._-]+$/.test(sanitizedKeyName)) {
    return res.status(400).json({ error: 'Key file name may only contain letters, numbers, dot, underscore, and dash.' });
  }

  const sshDir = path.join(os.homedir(), '.ssh');
  const safeLabelToken = sanitizeLabelForKeyName(safeLabel);
  const defaultBaseName = `id_${normalizedType}_${safeLabelToken || 'profile'}`;
  const desiredBaseName = sanitizedKeyName || defaultBaseName;
  const baseName = buildUniqueKeyBaseName(sshDir, desiredBaseName);
  const privateKeyPath = path.join(sshDir, baseName);
  const publicKeyPath = `${privateKeyPath}.pub`;

  try {
    fs.mkdirSync(sshDir, { recursive: true });
  } catch (err) {
    return res.status(500).json({ error: `Failed to create SSH directory: ${err.message}` });
  }

  try {
    await generateSshKeyPair({
      privateKeyPath,
      keyType: normalizedType,
      passphrase: normalizedPassphrase,
      comment: `multi-git:${safeLabel}`
    });

    if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
      return res.status(500).json({ error: 'SSH key generation did not produce expected key files.' });
    }

    const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
    const config = readConfig();
    const profileId = Date.now().toString();
    const profileData = {
      id: profileId,
      label: safeLabel,
      privateKeyPath,
      userName: typeof userName === 'string' ? userName.trim() : '',
      userEmail: typeof userEmail === 'string' ? userEmail.trim() : ''
    };
    config.sshProfiles.push(profileData);

    if (keepPassword) {
      setStoredPassphrase(profileId, normalizedPassphrase);
    }

    const persisted = writeConfig(config);
    if (!persisted) {
      return res.status(500).json({ error: 'Failed to persist generated SSH profile to config.' });
    }

    return res.json({
      success: true,
      profileId,
      profile: profileData,
      privateKeyPath,
      publicKeyPath,
      publicKey,
      config: sanitizeConfigForClient(config)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to generate SSH key.' });
  }
});

app.post('/api/config/ssh/open-location', async (req, res) => {
  const { targetPath } = req.body || {};
  const resolvedPath = normalizeSshPath(targetPath);

  if (!resolvedPath) {
    return res.status(400).json({ error: 'Target path is required.' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(400).json({ error: `Path not found: ${resolvedPath}` });
  }

  const fileOrDirectory = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);
  const sshHome = path.join(os.homedir(), '.ssh');
  const relative = path.relative(sshHome, fileOrDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return res.status(400).json({ error: 'Opening locations is restricted to your ~/.ssh directory.' });
  }

  try {
    await openPathInFileExplorer(fileOrDirectory);
    return res.json({ success: true, openedPath: fileOrDirectory });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to open location.' });
  }
});

// ----------------- GIT ACTION API -----------------

// Verify repo and get status
app.get('/api/git/status', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) {
    return res.status(400).json({ error: 'No repository path provided' });
  }

  try {
    const { stdout } = await runGitCommand(repoPath, ['status', '--porcelain', '-b']);
    const statusData = parsePorcelainStatus(stdout);
    
    // Check if rebase or merge is in progress
    const isMerging = fs.existsSync(path.join(repoPath, '.git', 'MERGE_HEAD'));
    const isRebasing = fs.existsSync(path.join(repoPath, '.git', 'rebase-merge')) || fs.existsSync(path.join(repoPath, '.git', 'rebase-apply'));
    
    res.json({
      success: true,
      ...statusData,
      isMerging,
      isRebasing
    });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Git execution error' });
  }
});

// Get commit log history (last 30 commits)
app.get('/api/git/log', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    // %x1f (unit separator) cannot appear in commit messages, unlike "|"
    const { stdout } = await runGitCommand(repoPath, [
      'log',
      '-n', '50',
      '--pretty=format:%H\x1f%an\x1f%ad\x1f%s\x1f%D',
      '--date=relative'
    ]);

    const commits = stdout.trim() === '' ? [] : stdout.split('\n').map(line => {
      const [hash, author, date, message, refs] = line.split('\x1f');
      return {
        hash,
        author,
        date,
        message,
        refs: (refs || '').split(',').map(r => r.trim()).filter(r => r)
      };
    });

    res.json({ success: true, commits });
  } catch (err) {
    res.json({ success: true, commits: [] }); // Fail silently on fresh repo with no commits
  }
});

// Get branches (local and remote)
app.get('/api/git/branches', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    // Full refnames disambiguate local vs remote ("%(refname:short)" drops
    // the refs/remotes/ prefix, which made every branch look local)
    const { stdout } = await runGitCommand(repoPath, ['for-each-ref', 'refs/heads', 'refs/remotes', '--format=%(refname)']);
    const branchLines = stdout.split('\n').map(b => b.trim()).filter(b => b);

    const local = [];
    const remote = [];

    branchLines.forEach(ref => {
      if (ref.startsWith('refs/heads/')) {
        local.push(ref.substring('refs/heads/'.length));
      } else if (ref.startsWith('refs/remotes/')) {
        const name = ref.substring('refs/remotes/'.length);
        // Skip symbolic HEAD pointers like "origin/HEAD"
        if (/\/HEAD$/.test(name)) {
          return;
        }
        remote.push(name);
      }
    });

    res.json({ success: true, local, remote });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error listing branches' });
  }
});

// Checkout branch
app.post('/api/git/checkout', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { branch, isRemote } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!branch) return res.status(400).json({ error: 'Branch name is required' });

  try {
    let args = ['checkout'];
    if (isRemote) {
      // checkout remote branch locally
      // e.g. origin/feature -> feature
      const baseName = branch.substring(branch.indexOf('/') + 1);

      // If a local branch with this name already exists, just switch to it
      let localExists = false;
      try {
        await runGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${baseName}`]);
        localExists = true;
      } catch (err) {
        localExists = false;
      }

      if (localExists) {
        args.push(baseName);
      } else {
        args.push('-b', baseName, '--track', branch);
      }
    } else {
      args.push(branch);
    }

    const { stdout, stderr } = await runGitCommand(repoPath, args);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error checking out branch' });
  }
});

// Create branch
app.post('/api/git/create-branch', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { branchName } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!branchName) return res.status(400).json({ error: 'Branch name is required' });

  try {
    const { stdout, stderr } = await runGitCommand(repoPath, ['checkout', '-b', branchName]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error creating branch' });
  }
});

// Stage (add) file(s)
app.post('/api/git/stage', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { files } = req.body; // Array of file paths or '.'
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!files || !files.length) return res.status(400).json({ error: 'Files are required' });

  try {
    const args = ['add', ...files];
    const { stdout, stderr } = await runGitCommand(repoPath, args);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error staging files' });
  }
});

// Unstage (reset) file(s)
app.post('/api/git/unstage', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { files } = req.body; // Array of file paths or '.'
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!files || !files.length) return res.status(400).json({ error: 'Files are required' });

  try {
    let args;
    if (files.includes('.')) {
      args = ['reset', 'HEAD'];
    } else {
      args = ['reset', 'HEAD', '--', ...files];
    }
    const { stdout, stderr } = await runGitCommand(repoPath, args);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error unstaging files' });
  }
});

// Discard changes in a file
app.post('/api/git/discard', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { filePath, isUntracked } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!filePath) return res.status(400).json({ error: 'File path is required' });

  try {
    if (isUntracked) {
      // Remove untracked file
      const fullPath = resolveInsideRepo(repoPath, filePath);
      if (!fullPath) {
        return res.status(403).json({ error: 'Access denied: path is outside the repository' });
      }
      if (fs.existsSync(fullPath)) {
        saveToTrash(repoPath, filePath);
        fs.unlinkSync(fullPath);
      }
      res.json({ success: true, message: 'Untracked file deleted' });
    } else {
      // Discard tracked changes (current content is recoverable from trash)
      saveToTrash(repoPath, filePath);
      const { stdout, stderr } = await runGitCommand(repoPath, ['checkout', '--', filePath]);
      res.json({ success: true, stdout, stderr });
    }
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error discarding changes' });
  }
});

// Commit staged changes (optionally amending the previous commit)
app.post('/api/git/commit', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { message, amend } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!message) return res.status(400).json({ error: 'Commit message is required' });

  try {
    const args = ['commit', '-m', message];
    if (amend) {
      args.push('--amend');
    }
    const { stdout, stderr } = await runGitCommand(repoPath, args);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error committing changes' });
  }
});

// Get the last commit's full message (used to prefill amend)
app.get('/api/git/last-commit-message', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const { stdout } = await runGitCommand(repoPath, ['log', '-1', '--pretty=%B']);
    res.json({ success: true, message: stdout.replace(/\r?\n+$/, '') });
  } catch (err) {
    res.json({ success: true, message: '' }); // Repo with no commits
  }
});

// Undo (soft-reset) the last commit, keeping its changes staged
app.post('/api/git/undo-commit', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  const isMerging = fs.existsSync(path.join(repoPath, '.git', 'MERGE_HEAD'));
  const isRebasing = fs.existsSync(path.join(repoPath, '.git', 'rebase-merge')) || fs.existsSync(path.join(repoPath, '.git', 'rebase-apply'));
  if (isMerging || isRebasing) {
    return res.status(400).json({ error: 'Cannot undo a commit while a merge or rebase is in progress.' });
  }

  try {
    let hasParent = true;
    try {
      await runGitCommand(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD~1']);
    } catch (err) {
      hasParent = false;
    }

    if (hasParent) {
      await captureCheckpoint(repoPath, 'Undo last commit');
      const { stdout, stderr } = await runGitCommand(repoPath, ['reset', '--soft', 'HEAD~1']);
      res.json({ success: true, stdout, stderr });
    } else {
      // Root commit: deleting the HEAD ref un-commits it while keeping the
      // index (files stay staged), matching soft-reset semantics.
      const { stdout, stderr } = await runGitCommand(repoPath, ['update-ref', '-d', 'HEAD']);
      res.json({ success: true, stdout, stderr });
    }
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error undoing last commit' });
  }
});

// Get Diff for a file
app.get('/api/git/diff', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const filePath = req.query.path;
  const isStaged = req.query.staged === 'true';
  const isUntracked = req.query.untracked === 'true';

  if (!repoPath || !filePath) {
    return res.status(400).json({ error: 'Repository path and file path are required' });
  }

  try {
    if (isUntracked) {
      // Generate mock diff of all additions for untracked file
      const fullPath = resolveInsideRepo(repoPath, filePath);
      if (!fullPath) {
        return res.status(403).json({ error: 'Access denied: path is outside the repository' });
      }
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      // Read file and represent it as diff lines
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      const diffLines = fileContent.split(/\r?\n/).map((line, index) => ({
        type: 'addition',
        content: line,
        oldLine: null,
        newLine: index + 1
      }));
      return res.json({ success: true, diff: diffLines });
    }

    const args = ['diff'];
    if (isStaged) {
      args.push('--cached');
    }
    args.push('--', filePath);

    const { stdout } = await runGitCommand(repoPath, args);
    
    // Parse git diff text
    const diffLines = parseGitDiffText(stdout);
    res.json({ success: true, diff: diffLines });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error generating diff' });
  }
});

function parseGitDiffText(diffText) {
  const lines = diffText.split('\n');
  const result = [];
  let oldLineNum = 0;
  let newLineNum = 0;
  let inDiff = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!inDiff) {
      if (line.startsWith('diff --git')) {
        inDiff = true;
      }
      continue;
    }
    
    // Skip general headers and file-mode/rename metadata lines
    if (
      line.startsWith('diff --git') || line.startsWith('index ') ||
      line.startsWith('--- ') || line.startsWith('+++ ') ||
      line.startsWith('new file mode') || line.startsWith('deleted file mode') ||
      line.startsWith('old mode') || line.startsWith('new mode') ||
      line.startsWith('similarity index') || line.startsWith('dissimilarity index') ||
      line.startsWith('rename from') || line.startsWith('rename to') ||
      line.startsWith('copy from') || line.startsWith('copy to') ||
      line.startsWith('Binary files')
    ) {
      continue;
    }

    if (line.startsWith('@@')) {
      // Parse hunk header: e.g. @@ -12,4 +12,5 @@
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
        result.push({
          type: 'hunk',
          content: line,
          oldLine: null,
          newLine: null
        });
      }
      continue;
    }

    if (line.startsWith('+')) {
      result.push({
        type: 'addition',
        content: line.substring(1),
        oldLine: null,
        newLine: newLineNum++
      });
    } else if (line.startsWith('-')) {
      result.push({
        type: 'deletion',
        content: line.substring(1),
        oldLine: oldLineNum++,
        newLine: null
      });
    } else {
      result.push({
        type: 'normal',
        content: line.substring(1),
        oldLine: oldLineNum++,
        newLine: newLineNum++
      });
    }
  }

  return result;
}

function resolveRequestedSshKeyPath(sshKeyPath) {
  if (!sshKeyPath || typeof sshKeyPath !== 'string') {
    return null;
  }

  return path.resolve(sshKeyPath.replace(/~/g, os.homedir()));
}

async function getOriginRemoteUrl(repoPath) {
  try {
    const { stdout } = await runGitCommand(repoPath, ['remote', 'get-url', 'origin']);
    return stdout.trim();
  } catch (err) {
    return '';
  }
}

function isLikelyHttpRemote(remoteUrl) {
  if (!remoteUrl) {
    return false;
  }

  return /^https?:\/\//i.test(remoteUrl.trim());
}

function getGithubHttpsToSshCandidate(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') {
    return null;
  }

  const trimmed = remoteUrl.trim();
  const githubHttpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/i);
  if (!githubHttpsMatch) {
    return null;
  }

  const owner = githubHttpsMatch[1];
  const repo = githubHttpsMatch[2];
  return `git@github.com:${owner}/${repo}.git`;
}

async function runSyncOperationWithProfile(repoPath, gitArgs, profileId, sshKeyPath) {
  const config = readConfig();
  const profiles = config.sshProfiles || [];
  const requestedKeyPath = resolveRequestedSshKeyPath(sshKeyPath);

  let selectedProfile = null;
  if (profileId) {
    selectedProfile = profiles.find((profile) => profile.id === profileId) || null;
  }

  if (!selectedProfile && requestedKeyPath) {
    selectedProfile = profiles.find((profile) => path.resolve(profile.privateKeyPath) === requestedKeyPath) || null;
  }

  if (profileId && !selectedProfile) {
    const err = new Error('Selected SSH profile was not found.');
    err.statusCode = 400;
    throw err;
  }

  const effectiveKeyPath = selectedProfile ? selectedProfile.privateKeyPath : requestedKeyPath;
  const profileLabel = selectedProfile ? selectedProfile.label : null;
  const originRemoteUrl = await getOriginRemoteUrl(repoPath);

  if (selectedProfile && isLikelyHttpRemote(originRemoteUrl)) {
    const err = new Error(
      `Remote "origin" is configured with HTTPS (${originRemoteUrl}). This triggers GitHub account chooser popups. ` +
      'Switch your remote to SSH (for example git@github.com:owner/repo.git) to use SSH Profiles without account popups.'
    );
    err.statusCode = 400;
    throw err;
  }

  if (selectedProfile && hasStoredPassphrase(selectedProfile.id) && !vaultKey) {
    const err = new Error('Vault is locked. Unlock the vault to use the saved passphrase for this SSH profile.');
    err.statusCode = 400;
    throw err;
  }

  let askpassBridge = null;
  try {
    if (selectedProfile && vaultKey && hasStoredPassphrase(selectedProfile.id)) {
      const storedPassphrase = getStoredPassphrase(selectedProfile.id);
      if (storedPassphrase) {
        askpassBridge = createAskpassBridge(storedPassphrase);
        const customSshCommand = effectiveKeyPath
          ? buildSshCommand(effectiveKeyPath)
          : 'ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o NumberOfPasswordPrompts=1';

        const result = await runGitCommand(repoPath, gitArgs, null, {
          envOverrides: askpassBridge.envOverrides,
          customSshCommand
        });

        return { ...result, usedAskpass: true, profileLabel, originRemoteUrl };
      }
    }

    const result = await runGitCommand(repoPath, gitArgs, effectiveKeyPath || null);
    return { ...result, usedAskpass: false, profileLabel, originRemoteUrl };
  } finally {
    if (askpassBridge) {
      askpassBridge.cleanup();
    }
  }
}

// ----------------- SYNC (PUSH / PULL) API -----------------

// Push to Remote with custom SSH key
app.post('/api/git/push', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { sshKeyPath, branch, profileId, force } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    // Get current branch if not provided
    let targetBranch = branch;
    if (!targetBranch) {
      const { stdout } = await runGitCommand(repoPath, ['branch', '--show-current']);
      targetBranch = stdout.trim();
    }

    const pushArgs = ['push', '-u'];
    if (force) {
      // Lease: only overwrite the remote if it still matches our remote-tracking ref
      pushArgs.push('--force-with-lease');
    }
    pushArgs.push('origin', targetBranch);

    const { stdout, stderr, usedAskpass, profileLabel, originRemoteUrl } = await runSyncOperationWithProfile(
      repoPath,
      pushArgs,
      profileId,
      sshKeyPath
    );

    res.json({ success: true, stdout, stderr, usedAskpass, profileLabel, originRemoteUrl });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.stderr || err.error?.message || err.message || 'Error executing git push' });
  }
});

// Pull from Remote with custom SSH key
app.post('/api/git/pull', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { sshKeyPath, branch, profileId } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    let targetBranch = branch;
    if (!targetBranch) {
      const { stdout } = await runGitCommand(repoPath, ['branch', '--show-current']);
      targetBranch = stdout.trim();
    }

    const { stdout, stderr, usedAskpass, profileLabel, originRemoteUrl } = await runSyncOperationWithProfile(
      repoPath,
      ['pull', 'origin', targetBranch],
      profileId,
      sshKeyPath
    );

    res.json({ success: true, stdout, stderr, usedAskpass, profileLabel, originRemoteUrl });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.stderr || err.error?.message || err.message || 'Error executing git pull' });
  }
});

app.post('/api/config/ssh/public', (req, res) => {
  const { profileId, privateKeyPath } = req.body || {};
  const config = readConfig();
  let resolvedPrivatePath = '';

  if (profileId) {
    const profile = (config.sshProfiles || []).find((item) => item.id === profileId);
    if (!profile) {
      return res.status(404).json({ error: 'SSH profile not found.' });
    }
    resolvedPrivatePath = profile.privateKeyPath;
  } else if (privateKeyPath) {
    resolvedPrivatePath = path.resolve(String(privateKeyPath).replace(/~/g, os.homedir()));
  } else {
    return res.status(400).json({ error: 'Provide profileId or privateKeyPath.' });
  }

  if (!fs.existsSync(resolvedPrivatePath)) {
    return res.status(400).json({ error: `Private key file not found at: ${resolvedPrivatePath}` });
  }

  const publicKeyPath = `${resolvedPrivatePath}.pub`;
  if (!fs.existsSync(publicKeyPath)) {
    return res.status(404).json({ error: `Public key file not found at: ${publicKeyPath}` });
  }

  try {
    const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
    return res.json({ success: true, publicKeyPath, publicKey });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to read public key.' });
  }
});

app.get('/api/git/remote/origin', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) {
    return res.status(400).json({ error: 'No repository path provided' });
  }

  try {
    const remoteUrl = await getOriginRemoteUrl(repoPath);
    if (!remoteUrl) {
      return res.status(404).json({ error: 'Origin remote not found.' });
    }

    const suggestedSshUrl = getGithubHttpsToSshCandidate(remoteUrl);
    return res.json({
      success: true,
      remoteUrl,
      isHttp: isLikelyHttpRemote(remoteUrl),
      canConvertToSsh: Boolean(suggestedSshUrl),
      suggestedSshUrl
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to inspect origin remote.' });
  }
});

app.post('/api/git/remote/origin/convert-ssh', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) {
    return res.status(400).json({ error: 'No repository path provided' });
  }

  try {
    const remoteUrl = await getOriginRemoteUrl(repoPath);
    if (!remoteUrl) {
      return res.status(404).json({ error: 'Origin remote not found.' });
    }

    const suggestedSshUrl = getGithubHttpsToSshCandidate(remoteUrl);
    if (!suggestedSshUrl) {
      return res.status(400).json({
        error: 'Origin remote is not a convertible GitHub HTTPS URL. Update the remote manually for this repository.'
      });
    }

    await runGitCommand(repoPath, ['remote', 'set-url', 'origin', suggestedSshUrl]);
    return res.json({ success: true, remoteUrl: suggestedSshUrl });
  } catch (err) {
    return res.status(500).json({ error: err.stderr || err.error?.message || err.message || 'Failed to convert origin remote.' });
  }
});

// ----------------- MERGE & REBASE API -----------------

// Merge branch
app.post('/api/git/merge', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { branch } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!branch) return res.status(400).json({ error: 'Branch name is required' });

  try {
    await captureCheckpoint(repoPath, `Merge ${branch}`);
    const { stdout, stderr } = await runGitCommand(repoPath, ['merge', branch]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    // If it conflicts, git returns an error (exit code 1)
    // We send success: false but with the specific stderr and stdout
    res.json({ 
      success: false, 
      conflict: true, 
      error: err.stderr || err.error?.message || 'Merge conflict occurred' 
    });
  }
});

// Rebase onto branch
app.post('/api/git/rebase', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { branch } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!branch) return res.status(400).json({ error: 'Branch name is required' });

  try {
    await captureCheckpoint(repoPath, `Rebase onto ${branch}`);
    const { stdout, stderr } = await runGitCommand(repoPath, ['rebase', branch]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.json({ 
      success: false, 
      conflict: true, 
      error: err.stderr || err.error?.message || 'Rebase conflict occurred' 
    });
  }
});

// Abort merge or rebase
app.post('/api/git/abort', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { type } = req.body; // 'merge' or 'rebase'
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const cmd = type === 'rebase' ? ['rebase', '--abort'] : ['merge', '--abort'];
    const { stdout, stderr } = await runGitCommand(repoPath, cmd);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error aborting operation' });
  }
});

// ----------------- CONFLICT MANAGER API -----------------

// Read details of a conflicted file
app.get('/api/git/conflict/file', (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const filePath = req.query.path;

  if (!repoPath || !filePath) {
    return res.status(400).json({ error: 'Repository path and file path are required' });
  }

  try {
    const fullPath = resolveInsideRepo(repoPath, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied: path is outside the repository' });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    // Parse the file content into blocks (normal vs conflict)
    const lines = content.split(/\r?\n/);
    const cleanBlocks = [];
    let tempBlock = [];
    let state = 'normal'; // 'normal', 'ours', 'theirs'
    let oursLines = [];
    let theirsLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('<<<<<<<')) {
        if (tempBlock.length > 0) {
          cleanBlocks.push({ type: 'normal', text: tempBlock.join('\n') });
          tempBlock = [];
        }
        state = 'ours';
        oursLines = [];
      } else if (line.startsWith('=======')) {
        if (state === 'ours') {
          state = 'theirs';
          theirsLines = [];
        } else {
          // If ======= outside conflict, treat as normal text
          tempBlock.push(line);
        }
      } else if (line.startsWith('>>>>>>>')) {
        if (state === 'theirs') {
          cleanBlocks.push({
            type: 'conflict',
            ours: oursLines.join('\n'),
            theirs: theirsLines.join('\n'),
            info: line.substring(7).trim()
          });
          state = 'normal';
        } else {
          tempBlock.push(line);
        }
      } else {
        if (state === 'normal') {
          tempBlock.push(line);
        } else if (state === 'ours') {
          oursLines.push(line);
        } else if (state === 'theirs') {
          theirsLines.push(line);
        }
      }
    }
    if (tempBlock.length > 0) {
      cleanBlocks.push({ type: 'normal', text: tempBlock.join('\n') });
    }

    res.json({
      success: true,
      rawContent: content,
      blocks: cleanBlocks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve conflict for a file (save custom contents and stage it)
app.post('/api/git/conflict/resolve', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { filePath, resolvedContent } = req.body;

  if (!repoPath || !filePath || resolvedContent === undefined) {
    return res.status(400).json({ error: 'Repository path, file path, and resolved content are required' });
  }

  try {
    const fullPath = resolveInsideRepo(repoPath, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied: path is outside the repository' });
    }

    // Write resolved content back to file
    fs.writeFileSync(fullPath, resolvedContent, 'utf8');

    // Stage the resolved file
    const { stdout, stderr } = await runGitCommand(repoPath, ['add', filePath]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error resolving file conflict' });
  }
});

// Complete merge or rebase after resolving all conflicts
app.post('/api/git/conflict/continue', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { type } = req.body; // 'merge' or 'rebase'
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    let cmd;
    if (type === 'rebase') {
      const { stdout, stderr } = await runGitCommand(
        repoPath,
        ['rebase', '--continue'],
        null,
        { envOverrides: { GIT_EDITOR: 'true' } }
      );
      res.json({ success: true, stdout, stderr });
      return;
    } else {
      // Merge continue requires committing
      // Git commit will automatically use the default merge message if MERGE_MSG is present
      cmd = ['commit', '--no-edit'];
    }

    const { stdout, stderr } = await runGitCommand(repoPath, cmd);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error completing operation' });
  }
});

// ----------------- FOLDER SELECT & INIT API -----------------

// Open a native Windows folder browser dialog via PowerShell
app.get('/api/git/select-folder', (req, res) => {
  if (process.versions.electron || process.env.IS_ELECTRON === 'true') {
    return res.status(400).json({ error: 'Folder selection is handled by Electron in desktop mode' });
  }

  if (os.platform() !== 'win32') {
    return res.status(501).json({ error: 'Folder selection endpoint is only available on Windows web mode' });
  }

  const psCmd = `powershell -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select Git Repository Folder'; $result = $dialog.ShowDialog(); if ($result -eq 'OK') { Write-Output $dialog.SelectedPath }"`;
  
  exec(psCmd, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to open file dialog: ' + error.message });
    }
    const selectedPath = stdout.trim();
    res.json({ success: true, path: selectedPath });
  });
});

// Initialize a new Git repository in a folder
app.post('/api/git/init', async (req, res) => {
  const { repoPath } = req.body;
  if (!repoPath) {
    return res.status(400).json({ error: 'Repository folder path is required' });
  }
  try {
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }
    
    // Check if it already has a .git folder
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      return res.status(400).json({ error: 'A Git repository already exists in this folder' });
    }

    await runGitCommand(repoPath, ['init']);
    res.json({ success: true, message: 'Git repository initialized successfully' });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error initializing Git repository' });
  }
});

// ----------------- REPO FILES & BLAME API -----------------

// List all files in the repository
app.get('/api/git/files', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  try {
    const { stdout: trackedOut } = await runGitCommand(repoPath, ['ls-files']);
    const { stdout: untrackedOut } = await runGitCommand(repoPath, ['ls-files', '--others', '--exclude-standard']);
    
    const tracked = trackedOut.split('\n').map(f => f.trim()).filter(f => f);
    const untracked = untrackedOut.split('\n').map(f => f.trim()).filter(f => f);
    
    res.json({ success: true, tracked, untracked });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error listing repository files' });
  }
});

// Get file content
app.get('/api/git/file/content', (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const filePath = req.query.path;
  if (!repoPath || !filePath) {
    return res.status(400).json({ error: 'Repository path and file path are required' });
  }
  try {
    const fullPath = resolveInsideRepo(repoPath, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied: path is outside the repository' });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get file blame annotations
app.get('/api/git/file/blame', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const filePath = req.query.path;
  if (!repoPath || !filePath) {
    return res.status(400).json({ error: 'Repository path and file path are required' });
  }
  try {
    const { stdout } = await runGitCommand(repoPath, ['blame', '--date=short', filePath]);
    
    const lines = stdout.split('\n');
    const blameData = [];
    const regex = /^([\^0-9a-fA-F]+)\s+\((.*?)\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\)\s?(.*)$/;
    
    for (const line of lines) {
      if (!line) continue;
      const match = line.match(regex);
      if (match) {
        blameData.push({
          hash: match[1],
          author: match[2].trim(),
          date: match[3],
          lineNum: parseInt(match[4], 10),
          content: match[5]
        });
      } else {
        blameData.push({
          hash: 'unknown',
          author: 'unknown',
          date: '',
          lineNum: blameData.length + 1,
          content: line
        });
      }
    }
    res.json({ success: true, blame: blameData });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error executing git blame' });
  }
});

// Get detailed commit info & modified files
app.get('/api/git/commit/details', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const hash = req.query.hash;
  if (!repoPath || !hash) {
    return res.status(400).json({ error: 'Repository path and commit hash are required' });
  }
  try {
    // "git show --name-status" also covers root and merge commits, which
    // "diff-tree --no-commit-id" reports as empty.
    const { stdout: filesOut } = await runGitCommand(repoPath, ['show', hash, '--name-status', '--format=']);
    const files = filesOut.split('\n').map(l => l.trim()).filter(l => l).map(line => {
      const parts = line.split('\t');
      return {
        status: (parts[0] || '')[0] || 'M',
        // Renames/copies produce "R100\told\tnew"; show the new path
        path: unquoteGitPath(parts.length > 2 ? parts[2] : (parts[1] || ''))
      };
    });

    const { stdout: infoOut } = await runGitCommand(repoPath, ['show', '--quiet', '--pretty=format:%H\x1f%an\x1f%ae\x1f%ad\x1f%s', hash]);
    const [commitHash, author, email, date, message] = infoOut.trim().split('\x1f');

    res.json({
      success: true,
      commit: { hash: commitHash, author, email, date, message },
      files
    });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error fetching commit details' });
  }
});

// Get diff for a file in a specific commit
app.get('/api/git/commit/diff', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const hash = req.query.hash;
  const filePath = req.query.path;
  if (!repoPath || !hash || !filePath) {
    return res.status(400).json({ error: 'Repo path, hash, and file path are required' });
  }
  try {
    const { stdout } = await runGitCommand(repoPath, ['show', hash, '--', filePath]);
    const diffLines = parseGitDiffText(stdout);
    res.json({ success: true, diff: diffLines });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error generating commit file diff' });
  }
});

// ----------------- SAFETY NET: CHECKPOINTS & DISCARD TRASH -----------------

// Session-scoped checkpoints: HEAD is recorded before risky operations so the
// user gets a one-click "undo last operation". Cleared on server restart.
const operationCheckpoints = new Map(); // repoPath -> [{ id, label, head, createdAt }]
const MAX_CHECKPOINTS = 10;

async function captureCheckpoint(repoPath, label) {
  try {
    const key = path.resolve(repoPath);
    const { stdout } = await runGitCommand(repoPath, ['rev-parse', 'HEAD']);
    const head = stdout.trim();
    if (!head) return;

    const stack = operationCheckpoints.get(key) || [];
    stack.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      label,
      head,
      createdAt: Date.now()
    });
    operationCheckpoints.set(key, stack.slice(0, MAX_CHECKPOINTS));
  } catch (err) {
    // Repo without commits yet: nothing to checkpoint
  }
}

app.get('/api/git/checkpoints', (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  const stack = operationCheckpoints.get(path.resolve(repoPath)) || [];
  res.json({
    success: true,
    checkpoints: stack.map(c => ({ id: c.id, label: c.label, head: c.head.substring(0, 8), createdAt: c.createdAt }))
  });
});

app.post('/api/git/undo-operation', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { checkpointId } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  const isMerging = fs.existsSync(path.join(repoPath, '.git', 'MERGE_HEAD'));
  const isRebasing = fs.existsSync(path.join(repoPath, '.git', 'rebase-merge')) || fs.existsSync(path.join(repoPath, '.git', 'rebase-apply'));
  if (isMerging || isRebasing) {
    return res.status(400).json({ error: 'Finish or abort the in-progress merge/rebase first (use the conflict banner).' });
  }

  const key = path.resolve(repoPath);
  const stack = operationCheckpoints.get(key) || [];
  const index = stack.findIndex(c => c.id === checkpointId);
  if (index === -1) {
    return res.status(404).json({ error: 'Checkpoint not found (checkpoints reset when the app restarts).' });
  }

  const checkpoint = stack[index];
  try {
    const { stdout, stderr } = await runGitCommand(repoPath, ['reset', '--hard', checkpoint.head]);
    // Drop this checkpoint and everything newer than it
    operationCheckpoints.set(key, stack.slice(index + 1));
    res.json({ success: true, stdout, stderr, restoredHead: checkpoint.head.substring(0, 8) });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error undoing operation' });
  }
});

// Discard trash: file contents are copied here right before being discarded,
// so "discard" is recoverable for a while (24h, most recent 30 files).
const TRASH_ROOT = path.join(os.tmpdir(), 'multi-git-trash');
const TRASH_TTL_MS = 24 * 60 * 60 * 1000;
const TRASH_MAX_ENTRIES = 30;

function repoTrashDir(repoPath) {
  const hash = crypto.createHash('md5').update(path.resolve(repoPath).toLowerCase()).digest('hex').slice(0, 12);
  return path.join(TRASH_ROOT, hash);
}

function readTrashIndex(trashDir) {
  try {
    const indexPath = path.join(trashDir, 'index.json');
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }
  } catch (err) {
    console.warn('Failed to read trash index:', err.message);
  }
  return [];
}

function writeTrashIndex(trashDir, entries) {
  try {
    fs.mkdirSync(trashDir, { recursive: true });
    fs.writeFileSync(path.join(trashDir, 'index.json'), JSON.stringify(entries, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to write trash index:', err.message);
  }
}

function pruneTrash(trashDir, entries) {
  const now = Date.now();
  const kept = [];
  const dropped = [];
  entries.forEach((entry, i) => {
    if (now - entry.savedAt < TRASH_TTL_MS && kept.length < TRASH_MAX_ENTRIES) {
      kept.push(entry);
    } else {
      dropped.push(entry);
    }
  });
  dropped.forEach(entry => {
    try {
      if (fs.existsSync(entry.trashFile)) fs.unlinkSync(entry.trashFile);
    } catch (err) { /* best effort */ }
  });
  return kept;
}

function saveToTrash(repoPath, relPath) {
  try {
    const fullPath = resolveInsideRepo(repoPath, relPath);
    if (!fullPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return;
    }

    const trashDir = repoTrashDir(repoPath);
    fs.mkdirSync(trashDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const trashFile = path.join(trashDir, `${id}.bin`);
    fs.copyFileSync(fullPath, trashFile);

    let entries = readTrashIndex(trashDir);
    entries.unshift({ id, path: relPath, savedAt: Date.now(), trashFile });
    entries = pruneTrash(trashDir, entries);
    writeTrashIndex(trashDir, entries);
  } catch (err) {
    console.warn(`Failed to save ${relPath} to trash:`, err.message);
  }
}

app.get('/api/git/trash', (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  const trashDir = repoTrashDir(repoPath);
  let entries = readTrashIndex(trashDir);
  const pruned = pruneTrash(trashDir, entries);
  if (pruned.length !== entries.length) {
    writeTrashIndex(trashDir, pruned);
  }
  res.json({
    success: true,
    entries: pruned.map(e => ({ id: e.id, path: e.path, savedAt: e.savedAt }))
  });
});

app.post('/api/git/trash/restore', (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { id } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  const trashDir = repoTrashDir(repoPath);
  const entries = readTrashIndex(trashDir);
  const entry = entries.find(e => e.id === id);
  if (!entry) {
    return res.status(404).json({ error: 'Trash entry not found (entries expire after 24 hours).' });
  }
  if (!fs.existsSync(entry.trashFile)) {
    return res.status(404).json({ error: 'The saved copy is no longer available.' });
  }

  const targetPath = resolveInsideRepo(repoPath, entry.path);
  if (!targetPath) {
    return res.status(403).json({ error: 'Access denied: path is outside the repository' });
  }

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(entry.trashFile, targetPath);
    fs.unlinkSync(entry.trashFile);
    writeTrashIndex(trashDir, entries.filter(e => e.id !== id));
    res.json({ success: true, restoredPath: entry.path });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error restoring file from trash' });
  }
});

// ----------------- FETCH / CLONE API -----------------

// Fetch from origin with the selected SSH profile
app.post('/api/git/fetch', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { sshKeyPath, profileId } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const { stdout, stderr, usedAskpass, profileLabel, originRemoteUrl } = await runSyncOperationWithProfile(
      repoPath,
      ['fetch', '--prune', 'origin'],
      profileId,
      sshKeyPath
    );

    res.json({ success: true, stdout, stderr, usedAskpass, profileLabel, originRemoteUrl });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.stderr || err.error?.message || err.message || 'Error executing git fetch' });
  }
});

function deriveRepoNameFromUrl(url) {
  const trimmed = String(url).trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const lastSegment = trimmed.split(/[/:]/).pop() || '';
  const safe = lastSegment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'repository';
}

// Clone a repository using an optional SSH profile
app.post('/api/git/clone', async (req, res) => {
  const { url, parentDir, folderName, profileId } = req.body || {};

  const cloneUrl = typeof url === 'string' ? url.trim() : '';
  if (!cloneUrl) {
    return res.status(400).json({ error: 'Repository URL is required.' });
  }
  if (!parentDir || typeof parentDir !== 'string') {
    return res.status(400).json({ error: 'Destination folder is required.' });
  }

  const resolvedParent = path.resolve(parentDir);
  if (!fs.existsSync(resolvedParent) || !fs.statSync(resolvedParent).isDirectory()) {
    return res.status(400).json({ error: `Destination folder not found: ${resolvedParent}` });
  }

  const safeFolder = typeof folderName === 'string' && folderName.trim()
    ? folderName.trim()
    : deriveRepoNameFromUrl(cloneUrl);
  if (!/^[a-zA-Z0-9._ -]+$/.test(safeFolder)) {
    return res.status(400).json({ error: 'Folder name may only contain letters, numbers, spaces, dot, underscore, and dash.' });
  }

  const destPath = path.join(resolvedParent, safeFolder);
  if (fs.existsSync(destPath) && fs.readdirSync(destPath).length > 0) {
    return res.status(400).json({ error: `Destination already exists and is not empty: ${destPath}` });
  }

  const config = readConfig();
  let selectedProfile = null;
  if (profileId) {
    selectedProfile = (config.sshProfiles || []).find((profile) => profile.id === profileId) || null;
    if (!selectedProfile) {
      return res.status(400).json({ error: 'Selected SSH profile was not found.' });
    }
    if (isLikelyHttpRemote(cloneUrl)) {
      return res.status(400).json({
        error: 'SSH profiles only apply to SSH URLs (git@host:owner/repo.git). Use an SSH URL or clone without a profile.'
      });
    }
    if (hasStoredPassphrase(selectedProfile.id) && !vaultKey) {
      return res.status(400).json({ error: 'Vault is locked. Unlock the vault to use the saved passphrase for this SSH profile.' });
    }
  }

  let askpassBridge = null;
  try {
    const gitArgs = ['clone', '--', cloneUrl, destPath];
    const options = { timeoutMs: 30 * 60 * 1000 };

    if (selectedProfile) {
      options.customSshCommand = buildSshCommand(selectedProfile.privateKeyPath);
      const storedPassphrase = vaultKey ? getStoredPassphrase(selectedProfile.id) : null;
      if (storedPassphrase) {
        askpassBridge = createAskpassBridge(storedPassphrase);
        options.envOverrides = askpassBridge.envOverrides;
      }
    }

    const { stdout, stderr } = await runGitCommand(resolvedParent, gitArgs, null, options);
    res.json({
      success: true,
      stdout,
      stderr,
      repoPath: destPath,
      profileLabel: selectedProfile ? selectedProfile.label : null
    });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || err.message || 'Error cloning repository' });
  } finally {
    if (askpassBridge) {
      askpassBridge.cleanup();
    }
  }
});

// ----------------- STASH API -----------------

const STASH_REF_PATTERN = /^stash@\{\d+\}$/;

app.get('/api/git/stash', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const { stdout } = await runGitCommand(repoPath, ['stash', 'list', '--format=%gd\x1f%s\x1f%cr']);
    const stashes = stdout.split('\n').map(l => l.trim()).filter(l => l).map(line => {
      const [ref, message, date] = line.split('\x1f');
      return { ref, message, date };
    });
    res.json({ success: true, stashes });
  } catch (err) {
    res.json({ success: true, stashes: [] }); // Fresh repo without any commits
  }
});

app.post('/api/git/stash', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { message, includeUntracked } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const args = ['stash', 'push'];
    if (includeUntracked) args.push('-u');
    if (message && typeof message === 'string') args.push('-m', message);
    const { stdout, stderr } = await runGitCommand(repoPath, args);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error stashing changes' });
  }
});

app.post('/api/git/stash/apply', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { ref, pop } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!ref || !STASH_REF_PATTERN.test(ref)) {
    return res.status(400).json({ error: 'A valid stash reference (stash@{n}) is required' });
  }

  try {
    const { stdout, stderr } = await runGitCommand(repoPath, ['stash', pop ? 'pop' : 'apply', ref]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error applying stash' });
  }
});

app.post('/api/git/stash/drop', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { ref } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!ref || !STASH_REF_PATTERN.test(ref)) {
    return res.status(400).json({ error: 'A valid stash reference (stash@{n}) is required' });
  }

  try {
    const { stdout, stderr } = await runGitCommand(repoPath, ['stash', 'drop', ref]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error dropping stash' });
  }
});

// ----------------- HISTORY ACTIONS & TAGS API -----------------

// Prevent option injection: hashes and ref names must never look like flags
const HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/;
const TAG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

app.post('/api/git/cherry-pick', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { hash } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!hash || !HASH_PATTERN.test(hash)) return res.status(400).json({ error: 'A valid commit hash is required' });

  try {
    await captureCheckpoint(repoPath, `Cherry-pick ${hash.substring(0, 8)}`);
    const { stdout, stderr } = await runGitCommand(repoPath, ['cherry-pick', hash]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    // Conflicts leave the cherry-pick in progress; surface like merge conflicts
    res.json({
      success: false,
      conflict: true,
      error: err.stderr || err.error?.message || 'Cherry-pick failed'
    });
  }
});

app.post('/api/git/revert', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { hash } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!hash || !HASH_PATTERN.test(hash)) return res.status(400).json({ error: 'A valid commit hash is required' });

  try {
    await captureCheckpoint(repoPath, `Revert ${hash.substring(0, 8)}`);
    const { stdout, stderr } = await runGitCommand(repoPath, ['revert', '--no-edit', hash]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.json({
      success: false,
      conflict: true,
      error: err.stderr || err.error?.message || 'Revert failed'
    });
  }
});

app.post('/api/git/reset', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { hash, mode } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!hash || !HASH_PATTERN.test(hash)) return res.status(400).json({ error: 'A valid commit hash is required' });
  if (!['soft', 'mixed', 'hard'].includes(mode)) {
    return res.status(400).json({ error: 'Reset mode must be soft, mixed, or hard' });
  }

  try {
    await captureCheckpoint(repoPath, `Reset (${mode}) to ${hash.substring(0, 8)}`);
    const { stdout, stderr } = await runGitCommand(repoPath, ['reset', `--${mode}`, hash]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error resetting to commit' });
  }
});

// Commit history of a single file
app.get('/api/git/file/history', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const filePath = req.query.path;
  if (!repoPath || !filePath) {
    return res.status(400).json({ error: 'Repository path and file path are required' });
  }

  try {
    const { stdout } = await runGitCommand(repoPath, [
      'log', '-n', '50', '--follow',
      '--pretty=format:%H\x1f%an\x1f%ad\x1f%s',
      '--date=relative', '--', filePath
    ]);
    const commits = stdout.trim() === '' ? [] : stdout.split('\n').map(line => {
      const [hash, author, date, message] = line.split('\x1f');
      return { hash, author, date, message };
    });
    res.json({ success: true, commits });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error loading file history' });
  }
});

app.get('/api/git/tags', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const { stdout } = await runGitCommand(repoPath, [
      'for-each-ref', 'refs/tags',
      '--sort=-creatordate',
      '--format=%(refname:short)\x1f%(objectname:short)\x1f%(creatordate:relative)'
    ]);
    const tags = stdout.split('\n').map(l => l.trim()).filter(l => l).map(line => {
      const [name, hash, date] = line.split('\x1f');
      return { name, hash, date };
    });
    res.json({ success: true, tags });
  } catch (err) {
    res.json({ success: true, tags: [] });
  }
});

app.post('/api/git/tag', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { name, hash, message } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!name || !TAG_NAME_PATTERN.test(name)) {
    return res.status(400).json({ error: 'Tag name may only contain letters, numbers, dot, dash, slash, underscore.' });
  }
  if (hash && !HASH_PATTERN.test(hash)) {
    return res.status(400).json({ error: 'Invalid commit hash' });
  }

  try {
    const args = ['tag'];
    if (message && typeof message === 'string') {
      args.push('-a', '-m', message);
    }
    args.push(name);
    if (hash) args.push(hash);

    const { stdout, stderr } = await runGitCommand(repoPath, args);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error creating tag' });
  }
});

app.delete('/api/git/tag', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { name } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!name || !TAG_NAME_PATTERN.test(name)) {
    return res.status(400).json({ error: 'A valid tag name is required' });
  }

  try {
    const { stdout, stderr } = await runGitCommand(repoPath, ['tag', '-d', name]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error deleting tag' });
  }
});

app.post('/api/git/tag/push', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { name, sshKeyPath, profileId } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!name || !TAG_NAME_PATTERN.test(name)) {
    return res.status(400).json({ error: 'A valid tag name is required' });
  }

  try {
    const { stdout, stderr, profileLabel } = await runSyncOperationWithProfile(
      repoPath,
      ['push', 'origin', `refs/tags/${name}`],
      profileId,
      sshKeyPath
    );
    res.json({ success: true, stdout, stderr, profileLabel });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.stderr || err.error?.message || err.message || 'Error pushing tag' });
  }
});

// ----------------- BRANCH DELETE / DISCARD-ALL / IDENTITY API -----------------

app.post('/api/git/delete-branch', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { branch, force } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });
  if (!branch) return res.status(400).json({ error: 'Branch name is required' });

  try {
    const { stdout, stderr } = await runGitCommand(repoPath, ['branch', force ? '-D' : '-d', branch]);
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    const errorText = err.stderr || err.error?.message || 'Error deleting branch';
    res.status(500).json({
      error: errorText,
      // Lets the UI offer a force-delete follow-up
      notFullyMerged: /not fully merged/i.test(errorText)
    });
  }
});

// Discard every unstaged change (and optionally untracked files)
app.post('/api/git/discard-all', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { deleteUntracked } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    // Save every file about to be touched into the recoverable trash
    try {
      const { stdout } = await runGitCommand(repoPath, ['ls-files', '-m', '-o', '--exclude-standard']);
      stdout.split('\n').map(l => unquoteGitPath(l)).filter(l => l).forEach(relPath => {
        saveToTrash(repoPath, relPath);
      });
    } catch (err) {
      console.warn('Could not snapshot files before discard-all:', err.message);
    }

    let checkoutError = null;
    try {
      await runGitCommand(repoPath, ['checkout', '--', '.']);
    } catch (err) {
      // Fails on a repo with no commits yet; still allow the clean step
      checkoutError = err.stderr || err.error?.message || null;
    }

    if (deleteUntracked) {
      await runGitCommand(repoPath, ['clean', '-fd']);
    } else if (checkoutError) {
      return res.status(500).json({ error: checkoutError });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error discarding changes' });
  }
});

async function readGitConfigValue(repoPath, key, scopeFlag) {
  try {
    const args = ['config'];
    if (scopeFlag) args.push(scopeFlag);
    args.push('--get', key);
    const { stdout } = await runGitCommand(repoPath, args);
    return stdout.trim();
  } catch (err) {
    return ''; // Unset keys make git config exit non-zero
  }
}

// Per-repo committer identity (multi-account: the SSH key switches auth,
// this switches authorship)
app.get('/api/git/identity', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  try {
    const [name, email, localName, localEmail] = await Promise.all([
      readGitConfigValue(repoPath, 'user.name'),
      readGitConfigValue(repoPath, 'user.email'),
      readGitConfigValue(repoPath, 'user.name', '--local'),
      readGitConfigValue(repoPath, 'user.email', '--local')
    ]);

    res.json({
      success: true,
      name,
      email,
      isLocal: Boolean(localName || localEmail)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error reading git identity' });
  }
});

app.post('/api/git/identity', async (req, res) => {
  const repoPath = req.headers['x-repo-path'];
  const { name, email } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: 'No repository path provided' });

  const safeName = typeof name === 'string' ? name.trim() : '';
  const safeEmail = typeof email === 'string' ? email.trim() : '';
  if (!safeName || !safeEmail) {
    return res.status(400).json({ error: 'Both name and email are required' });
  }

  try {
    await runGitCommand(repoPath, ['config', 'user.name', safeName]);
    await runGitCommand(repoPath, ['config', 'user.email', safeEmail]);
    res.json({ success: true, name: safeName, email: safeEmail });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.error?.message || 'Error saving git identity' });
  }
});

// ----------------- START SERVER -----------------

function startServer(options = {}) {
  // options.port may legitimately be 0 (ask the OS for any free port)
  const port = options.port !== undefined ? options.port : PORT;
  const isElectron = Boolean(process.versions.electron || process.env.IS_ELECTRON === 'true');
  const shouldOpenBrowser = options.openBrowser !== undefined ? options.openBrowser : !isElectron;

  return new Promise((resolve, reject) => {
    // Bind to loopback only: this API executes git/filesystem operations and
    // must never be reachable from other machines on the network.
    const server = app.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      const url = `http://localhost:${actualPort}`;
      console.log(`Server started on ${url}`);

      if (isElectron && !shouldOpenBrowser) {
        console.log('Running in Electron. Skipping browser autostart.');
      }

      maybeOpenBrowser(url, shouldOpenBrowser);
      resolve(server);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer
};
