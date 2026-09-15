const fs = require('fs/promises');
const path = require('path');

/** US English, Unicode: what rcedit and electron-builder fall back to. */
const DEFAULT_LANGUAGE = { lang: 1033, codepage: 1200 };

/**
 * electron-builder's own resource editing is switched off by
 * `win.signAndEditExecutable: false`, which also skips signing. Stamp the
 * Windows executable's icon and version metadata here instead, with resedit:
 * the pure-JavaScript editor electron-builder itself uses, so this needs no
 * native binary and nothing extracted from a signing-tool archive. It replaced
 * node-rcedit, which npm now marks as no longer supported.
 */
module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const ResEdit = await import('resedit');
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

  const executable = ResEdit.NtExecutable.from(await fs.readFile(executablePath));
  const resources = ResEdit.NtExecutableResource.from(executable);

  // Electron's generic version resource survives unless this replaces it.
  const [existing] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const versionInfo = existing ?? ResEdit.Resource.VersionInfo.createEmpty();
  const [language = DEFAULT_LANGUAGE] = versionInfo.getAllLanguagesForStringValues();
  const fileVersion = appInfo.shortVersion || appInfo.buildVersion;

  versionInfo.setFileVersion(fileVersion);
  versionInfo.setProductVersion(
    appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm()
  );
  versionInfo.setStringValues(language, {
    CompanyName: appInfo.companyName || '',
    FileDescription: appInfo.description,
    // setFileVersion writes the four-part form; keep the version as released.
    FileVersion: fileVersion,
    InternalName: appInfo.productFilename,
    LegalCopyright: appInfo.copyright,
    OriginalFilename: `${appInfo.productFilename}.exe`,
    ProductName: appInfo.productName
  });
  versionInfo.outputToResourceEntries(resources.entries);

  const icon = ResEdit.Data.IconFile.from(await fs.readFile(iconPath));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    language.lang,
    icon.icons.map((item) => item.data)
  );

  resources.outputResource(executable);
  await fs.writeFile(executablePath, Buffer.from(executable.generate()));
};
