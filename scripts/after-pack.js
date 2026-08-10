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
  const { appInfo } = context.packager;
  const executablePath = path.join(
    context.appOutDir,
    `${appInfo.productFilename}.exe`
  );
  const iconPath = path.join(
    context.packager.projectDir,
    'docs',
    'images',
    'multi-git-logo.ico'
  );

  // signAndEditExecutable is disabled because electron-builder's signing-tool
  // archive can fail to extract on Windows without Developer Mode. That also
  // means Electron's generic version resource survives unless this hook
  // replaces it along with the icon.
  await rcedit(executablePath, {
    icon: iconPath,
    'file-version': appInfo.shortVersion || appInfo.buildVersion,
    'product-version': appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
    'version-string': {
      CompanyName: appInfo.companyName || '',
      FileDescription: appInfo.description,
      InternalName: appInfo.productFilename,
      LegalCopyright: appInfo.copyright,
      OriginalFilename: `${appInfo.productFilename}.exe`,
      ProductName: appInfo.productName
    }
  });
};
