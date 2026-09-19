'use strict';

// electron-builder's beforePack: puts the terminal edition inside every
// desktop build, as resources/terminal, so the desktop app can enable the
// `multi-git` command without downloading anything.
//
// macOS is one universal build that electron-builder packs once per
// architecture and then merges. Each pack gets its own architecture's Node,
// which the merge combines into one universal binary; the merge refuses any
// other file that differs, so both manifests say `universal`.
const path = require('node:path');
const { buildPayload } = require('./terminal-package.cjs');

/** electron-builder's Arch enum, by value. */
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

module.exports = async (context) => {
  const arch = ARCH_NAMES[context.arch];
  const platform = context.electronPlatformName;
  // A pack named universal has no Node of its own to take; this machine's will do.
  const nodeArch = arch === 'universal' ? process.arch : arch;

  // Where build.extraResources in package.json reads it from.
  const destination = path.join(context.packager.projectDir, '.terminal-bundle', arch);
  await buildPayload(destination, platform, nodeArch, platform === 'darwin' ? { manifestArch: 'universal' } : {});
};
