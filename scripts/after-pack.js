const path = require('path');

/**
 * electron-builder normally uses winCodeSign to edit the executable. Its
 * archive contains macOS symlinks, which Windows may refuse to extract when
 * Developer Mode is disabled. Use node-rcedit's Windows-only binary instead.
 */
module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const { rcedit } = await import('rcedit');
  const executablePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  );
  const iconPath = path.join(context.packager.projectDir, 'Multi Git Logo.ico');

  await rcedit(executablePath, { icon: iconPath });
};
