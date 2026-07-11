# Security Policy

Security matters especially for Multi-Git because it works with local repositories, filesystem paths, Git processes, SSH identities, and optionally encrypted passphrases.

## Supported Versions

Security fixes are currently applied to the latest release line only.

| Version | Supported |
| --- | --- |
| Latest `1.0.x` release | Yes |
| Older releases | No |

Before reporting an issue, confirm it still exists on the latest release or current `main` branch when it is safe to do so.

## Report a Vulnerability Privately

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/AnthonyKopri/multi-git/security/advisories/new) to send the report directly to the maintainer. If that option is unavailable, contact the maintainer privately before sharing technical details publicly.

Include as much of the following as is safe and relevant:

- The affected version, commit, and installation type.
- Operating system, Git version, Node.js version, and OpenSSH version.
- A clear description of the issue and its potential impact.
- Minimal reproduction steps using a disposable repository and fake credentials.
- Whether user interaction or a particular repository state is required.
- Any suggested mitigation or patch.

Never include a real private key, passphrase, vault master key, access token, personal repository content, or other live secret. Create redacted output or disposable test data instead.

## In Scope

Examples of relevant security reports include:

- Command or argument injection through repository paths, filenames, refs, remotes, or API input.
- Access to files outside the selected repository.
- A way for a remote website or non-local host to control the local backend.
- Exposure of SSH passphrases, private key contents, vault material, or sensitive configuration.
- Bypassing vault authentication or weakening its encryption guarantees.
- Unsafe temporary files, permissions, or askpass handling.
- Destructive Git or filesystem behavior that occurs without the documented confirmation or scope.
- Vulnerable dependencies with a practical impact on Multi-Git.

Reports about normal Git behavior, social engineering without a product vulnerability, or attacks requiring an already fully compromised local account may be out of scope. They are still welcome when the impact is unclear.

## What to Expect

The maintainer will aim to:

1. Acknowledge a complete report within 7 days.
2. Confirm whether the issue can be reproduced and is in scope.
3. Provide a status update or next steps within 14 days when possible.
4. Coordinate a fix and disclosure timeline based on severity and maintainer availability.
5. Credit the reporter in the advisory or release notes if requested and appropriate.

These are targets for a volunteer-maintained project, not guaranteed service-level commitments. Please allow a reasonable remediation period before public disclosure.

## Security Design Notes

- The backend binds to `127.0.0.1` and validates localhost Host and Origin values.
- Selected SSH profiles are applied to individual Git operations through `GIT_SSH_COMMAND`.
- Saved passphrases are encrypted with AES-256-GCM using a key derived with `scrypt`.
- The derived vault key exists only in application memory while the vault is unlocked.
- Private key files remain at their original paths and are not copied into the app configuration.

These controls reduce risk but do not make the application a replacement for operating-system security, full-disk encryption, backups, or careful key management.
