'use strict';

// The terminal edition's payload: the compiled toolkit, its production
// dependencies, skills, docs, and a Node runtime of its own, so it runs on a
// machine with Git and nothing else.
//
// Used three ways: by electron-builder's beforePack, to put the payload inside
// every desktop build; by build-terminal.cjs, to make the six standalone
// archives; and at runtime, by `multi-git update` and the desktop's installer,
// for the download, checksum and extraction helpers below.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

/** The runtime the terminal edition ships, verified against nodejs.org's SHASUMS256.txt. */
const NODE_VERSION = '24.18.0';
const ROOT = path.resolve(__dirname, '..');
const PLATFORMS = ['win32', 'darwin', 'linux'];
const ARCHES = ['x64', 'arm64'];
/** Refuse to unpack more than this, whatever the archive claims. */
const EXTRACT_LIMIT = 1024 * 1024 * 1024;

/** Rejects names that could land outside the destination or mean something else on Windows. */
function safeEntry(name) {
  const trimmed = name.replace(/\/$/, '');
  if (
    !trimmed ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    trimmed.split('/').some((part) => part === '' || part === '.' || part === '..' || part.includes(':') ||
      /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])([.]|$)/i.test(part))
  ) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return name;
}

/**
 * Unpacks a .zip or .tar.gz into `destination`, which must not exist yet or be
 * empty. Links, device files, absolute or parent paths, duplicate names (as
 * Windows and macOS compare them) and archives over the size limit are refused
 * rather than skipped, because a package that contains one is not ours.
 */
async function extractArchive(file, destination, select = () => true) {
  if (fs.existsSync(destination) && (fs.lstatSync(destination).isSymbolicLink() || fs.readdirSync(destination).length)) {
    throw new Error('Archive extraction requires an empty destination.');
  }
  fs.mkdirSync(destination, { recursive: true });
  let total = 0;
  const names = new Set();
  const accept = (name, size) => {
    safeEntry(name);
    if (!select(name)) {
      return false;
    }
    total += size;
    if (total > EXTRACT_LIMIT) {
      throw new Error('Archive exceeds the extraction size limit.');
    }
    const key = name.replace(/\/$/, '').toLowerCase();
    if (names.has(key)) {
      throw new Error(`Duplicate archive entry: ${name}`);
    }
    names.add(key);
    return true;
  };

  if (!file.endsWith('.zip')) {
    const tar = require('tar');
    let invalid = null;
    await tar.x({
      file,
      cwd: destination,
      strict: true,
      preservePaths: false,
      filter: (name, entry) => {
        if (invalid) return false;
        try {
        // Official Node archives also contain npm symlinks. They are not part
        // of our runtime payload; only reject links selected for extraction.
        safeEntry(name);
        if (!select(name)) return false;
        if (!['File', 'OldFile', 'Directory'].includes(entry.type)) {
          throw new Error(`Links and special files are not allowed: ${name}`);
        }
        return accept(name, entry.size ?? 0);
        } catch (error) {
          // A filter is called from an event handler; throwing there is an
          // uncaught exception, not a rejection of tar.x's promise.
          invalid = error;
          return false;
        }
      }
    });
    if (invalid) throw invalid;
    return;
  }

  const yauzl = require('yauzl');
  await new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      const fail = (failure) => {
        zip.close();
        reject(failure);
      };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        void (async () => {
          const name = entry.fileName;
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode === 0o120000) {
            throw new Error(`Symbolic link rejected: ${name}`);
          }
          if (!accept(name, entry.uncompressedSize)) {
            zip.readEntry();
            return;
          }
          const target = path.join(destination, name);
          if (name.endsWith('/')) {
            fs.mkdirSync(target, { recursive: true });
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const stream = await new Promise((done, failed) =>
              zip.openReadStream(entry, (failure, value) => (failure ? failed(failure) : done(value)))
            );
            const permissions = (entry.externalFileAttributes >>> 16) & 0o777;
            await pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: permissions & 0o100 ? 0o755 : 0o644 }));
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}

/**
 * Writes a ZIP of `sourceDir`'s contents. Deflate from Node's own zlib, so the
 * Windows archives can be made on any runner without a zip program.
 */
function writeZip(sourceDir, outputFile) {
  const entries = [];
  const walk = (directory, prefix) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, item.name);
      const name = prefix + item.name;
      if (item.isDirectory()) {
        entries.push({ name: `${name}/`, directory: true, mode: 0o755 });
        walk(absolute, `${name}/`);
      } else if (item.isFile()) {
        entries.push({ name, data: fs.readFileSync(absolute), mode: fs.statSync(absolute).mode & 0o777 });
      } else {
        throw new Error(`Only files and folders can be packaged: ${absolute}`);
      }
    }
  };
  walk(sourceDir, '');

  // A fixed timestamp, so the same payload always makes the same archive.
  const dosTime = 0;
  const dosDate = (2020 - 1980) << 9 | 1 << 5 | 1;
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.directory ? Buffer.alloc(0) : entry.data;
    const compressed = entry.directory ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const crc = entry.directory ? 0 : zlib.crc32(raw);
    const method = entry.directory ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x031e, 4); // made by Unix, so the mode below is read
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(crc >>> 0, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE((((entry.directory ? 0o040000 : 0o100000) | entry.mode) << 16 | (entry.directory ? 0x10 : 0)) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  if (offset + centralSize > 0xffffffff || entries.length > 0xffff) {
    throw new Error('The payload is too large for a ZIP without ZIP64.');
  }
  fs.writeFileSync(outputFile, Buffer.concat([...chunks, ...central, end]), { flag: 'wx' });
}

/** Streams a download to `target`, hashing as it goes. Returns the SHA-256. */
async function download(url, target, limit = 256 * 1024 * 1024) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'multi-git-terminal' },
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  let bytes = 0;
  const hash = crypto.createHash('sha256');
  const handle = await fs.promises.open(target, 'wx', 0o600);
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > limit) {
        throw new Error('Download exceeds the size limit.');
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/**
 * The stable commands on PATH. Each reads current.txt and runs that version,
 * so an update is one atomic rename of that file, and a session already
 * running keeps the version it started with.
 */
function launcherFiles() {
  return {
    'multi-git':
      '#!/bin/sh\n' +
      'set -eu\n' +
      'BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n' +
      'VERSION=$(cat "$BASE/current.txt")\n' +
      'case "$VERSION" in ""|*[!0-9A-Za-z.-]*) echo "multi-git: the installation is damaged (current.txt). Repair it from the desktop app\'s Settings, or reinstall." >&2; exit 2;; esac\n' +
      'exec "$BASE/versions/$VERSION/runtime/node" "$BASE/versions/$VERSION/scripts/multi-git.cjs" "$@"\n',
    'multi-git.cmd':
      '@echo off\r\n' +
      'setlocal\r\n' +
      'set /p MULTIGIT_VERSION=<"%~dp0current.txt"\r\n' +
      'if not exist "%~dp0versions\\%MULTIGIT_VERSION%\\runtime\\node.exe" (\r\n' +
      '  echo multi-git: the installation is damaged. Repair it in the desktop app under Settings, or reinstall. 1>&2\r\n' +
      '  exit /b 2\r\n' +
      ')\r\n' +
      '"%~dp0versions\\%MULTIGIT_VERSION%\\runtime\\node.exe" "%~dp0versions\\%MULTIGIT_VERSION%\\scripts\\multi-git.cjs" %*\r\n'
  };
}

let checksums = null;
async function nodeChecksums() {
  if (checksums === null) {
    const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, {
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      throw new Error('Cannot fetch the Node checksums to verify the bundled runtime.');
    }
    checksums = await response.text();
  }
  return checksums;
}

/** Downloads (or reuses from the cache) one official Node build, and returns its node executable. */
async function nodeExecutable(platform, arch, scratch) {
  const nodePlatform = platform === 'win32' ? 'win' : platform;
  const stem = `node-v${NODE_VERSION}-${nodePlatform}-${arch}`;
  const basename = `${stem}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const expected = (await nodeChecksums())
    .split('\n')
    .find((line) => line.trim().endsWith(`  ${basename}`))
    ?.split(/\s+/)[0];
  if (!expected) {
    throw new Error(`nodejs.org lists no checksum for ${basename}.`);
  }

  const cache = path.join(ROOT, '.terminal-cache');
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, basename);
  const actual = fs.existsSync(archive)
    ? crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    : await download(`https://nodejs.org/dist/v${NODE_VERSION}/${basename}`, archive);
  if (actual !== expected) {
    fs.rmSync(archive, { force: true });
    throw new Error(`${basename} does not match its published checksum.`);
  }

  const executable = platform === 'win32' ? `${stem}/node.exe` : `${stem}/bin/node`;
  const into = path.join(scratch, `${platform}-${arch}`);
  await extractArchive(archive, into, (name) => name === executable || name === `${stem}/LICENSE`);
  return { executable: path.join(into, executable), license: path.join(into, stem, 'LICENSE') };
}

/**
 * The toolkit's entry points with every dependency inlined, so the payload
 * needs no node_modules. That is not only smaller: electron-builder drops any
 * node_modules folder from extraResources, whatever its filter says, so a
 * payload that needed one would not run from inside the desktop app.
 */
async function bundleToolkit(destination) {
  const { build } = require('esbuild');
  const common = {
    absWorkingDir: ROOT,
    bundle: true,
    platform: 'node',
    target: 'node22.12',
    minify: true,
    legalComments: 'eof',
    logLevel: 'warning',
    plugins: [
      {
        // Ink loads React DevTools only when DEV=true, but once bundled its
        // import would be unconditional. Nothing ships it, so it is a stub.
        name: 'no-react-devtools',
        setup(builder) {
          builder.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export default { initialize() {}, connectToDevTools() {} };',
            loader: 'js'
          }));
        }
      }
    ],
    external: []
  };
  const server = path.join(destination, 'out', 'node', 'server');

  await build({ ...common, format: 'cjs', entryPoints: ['src/server/agent-cli/main.ts'], outfile: path.join(server, 'agent-cli.js') });
  await build({ ...common, format: 'cjs', entryPoints: ['src/server/runtime/daemon.ts'], outfile: path.join(server, 'daemon.js') });
  await build({
    ...common,
    format: 'esm',
    entryPoints: ['src/server/terminal/app.tsx'],
    outfile: path.join(server, 'terminal.mjs'),
    banner: {
      js:
        "import { createRequire as __createRequire } from 'node:module';" +
        "import { fileURLToPath as __fileURLToPath } from 'node:url';" +
        "import { dirname as __dirnameOf } from 'node:path';" +
        'const require = __createRequire(import.meta.url);' +
        'const __dirname = __dirnameOf(__fileURLToPath(import.meta.url));'
    }
  });
  // This file, for `multi-git update` and the desktop's installer: the download
  // and extraction helpers with tar and yauzl inside. A payload is never built
  // from a payload, so esbuild itself stays out.
  await build({
    ...common,
    format: 'cjs',
    entryPoints: ['scripts/terminal-package.cjs'],
    outfile: path.join(destination, 'scripts', 'terminal-package.cjs'),
    external: [...common.external, 'esbuild']
  });
}

/**
 * Assembles the payload for one platform and architecture in `destination`.
 *
 * `manifestArch` is what the manifest records, when that is not `arch`: the
 * macOS desktop app is one universal build, packed once per architecture and
 * then merged. The merge makes one universal binary from the two Node
 * runtimes, and requires every other file to be identical, so both packs say
 * `universal`.
 */
async function buildPayload(destination, platform, arch, { manifestArch = arch } = {}) {
  if (!PLATFORMS.includes(platform) || !ARCHES.includes(arch)) {
    throw new Error(`No terminal payload for ${platform}-${arch}.`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  const copies = ['out/web', 'templates', 'skills', 'docs/agent-cli.md', 'docs/terminal.md', 'docs/mcp.md', 'docs/terminal-parity.md', 'docs/testing', 'LICENSE'];
  for (const entry of copies) {
    const source = path.join(ROOT, entry);
    if (!fs.existsSync(source)) {
      if (entry.startsWith('out/')) {
        throw new Error(`${entry} is missing. Run npm run compile first.`);
      }
      continue;
    }
    fs.cpSync(source, path.join(destination, entry), {
      recursive: true,
      // Source maps are for debugging this repository, not for users.
      filter: (file) => !file.endsWith('.map')
    });
  }

  await bundleToolkit(destination);
  // Bundling removes node_modules, but not our obligation to ship its licenses.
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  for (const [folder, metadata] of Object.entries(lock.packages)) {
    if (!folder.startsWith('node_modules/') || metadata.dev) continue;
    const installed = path.join(ROOT, folder);
    if (!fs.existsSync(installed)) continue;
    const licenseDir = path.join(destination, 'licenses', folder.replaceAll('node_modules/', ''));
    fs.mkdirSync(licenseDir, { recursive: true });
    fs.writeFileSync(path.join(licenseDir, 'package.json'), JSON.stringify({ name: folder, version: metadata.version, license: metadata.license }, null, 2));
    for (const file of fs.readdirSync(installed)) {
      if (/^(licen[sc]e|copying|notice)([.-]|$)/i.test(file) && fs.statSync(path.join(installed, file)).isFile()) {
        fs.copyFileSync(path.join(installed, file), path.join(licenseDir, file));
      }
    }
  }
  fs.copyFileSync(path.join(ROOT, 'scripts', 'multi-git.cjs'), path.join(destination, 'scripts', 'multi-git.cjs'));

  // What app-root.ts looks for to find the application root.
  fs.writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, license: pkg.license }, null, 2)
  );

  fs.mkdirSync(path.join(ROOT, '.terminal-cache'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(ROOT, '.terminal-cache', 'extract-'));
  const runtime = path.join(destination, 'runtime');
  const executableName = platform === 'win32' ? 'node.exe' : 'node';
  fs.mkdirSync(runtime, { recursive: true });
  try {
    const node = await nodeExecutable(platform, arch, scratch);
    fs.copyFileSync(node.executable, path.join(runtime, executableName));
    fs.copyFileSync(node.license, path.join(runtime, 'LICENSE'));
    fs.chmodSync(path.join(runtime, executableName), 0o755);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(destination, 'terminal-manifest.json'),
    JSON.stringify({ schemaVersion: 1, product: 'multi-git-terminal', version: pkg.version, platform, arch: manifestArch, nodeVersion: NODE_VERSION }, null, 2)
  );
}

module.exports = { NODE_VERSION, safeEntry, extractArchive, writeZip, download, launcherFiles, buildPayload };

if (require.main === module) {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || process.arch;
  const destination = path.resolve(process.argv[4] || path.join('.terminal-bundle', arch));
  buildPayload(destination, platform, arch)
    .then(() => console.log(`Terminal payload: ${destination}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
