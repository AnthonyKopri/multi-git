// Transitional entry point: re-exports the extracted modules as a single
// CommonJS bundle that the un-migrated server.js can require.
//
// It exists so there is exactly one implementation of each parser while the
// migration is in progress. Without it, server.js would keep its own copies
// and the test suite would be asserting against code that does not run.
//
// Phase 3 replaces server.js with src/server/routes/*, at which point this
// file and its build entry are deleted.
export { unquoteGitPath, parsePorcelainStatus } from './git/status';
export { parseGitDiffText } from './git/diff';
export { parseConflictBlocks } from './git/conflicts';
export { parseBlameOutput } from './git/blame';
export { getToggledRemoteUrl, isLikelyHttpRemote, parseRemoteUrl } from './git/remote';
export { resolveInsideRepo } from './fs/paths';
export {
  VAULT_CHECK_VALUE,
  decryptWithVaultKey,
  deriveVaultKey,
  encryptWithVaultKey,
  generateSalt
} from './vault/crypto';
export {
  InvalidGitArgumentError,
  commitish,
  githubRepoName,
  pathArg,
  pathArgs,
  refArg
} from './git/args';
export { findGitignore, findLicense, listGitignores, listLicenses } from './templates/catalogue';
export {
  CUSTOM_GITIGNORE_STARTER,
  renderGitignore,
  renderLicense,
  sanitizePlaceholderValue
} from './templates/render';
export { appRoot, fromAppRoot, staticDir, templatesDir } from './app-root';
