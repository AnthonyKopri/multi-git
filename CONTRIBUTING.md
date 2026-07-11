# Contributing to Multi-Git

Thank you for taking the time to improve Multi-Git. Contributions can include bug reports, feature proposals, documentation, testing, design feedback, and code.

## Before You Start

- Search existing issues and pull requests before opening a duplicate.
- Use the bug report or feature request form when one matches your request.
- For a large feature, architectural change, or new dependency, open an issue first so the approach can be discussed before substantial work begins.
- Report security vulnerabilities privately by following [SECURITY.md](SECURITY.md). Never publish credentials, private keys, passphrases, repository contents, or exploit details in an issue.
- Keep changes focused. Separate unrelated fixes into separate pull requests.

## Development Setup

You will need:

- Node.js 18 or newer and npm.
- Git available on `PATH`.
- OpenSSH tools, including `ssh` and `ssh-keygen`.
- A disposable Git repository for workflow testing.
- Windows when testing the currently published installer and portable build targets.

Fork the repository, clone your fork, and install dependencies:

```bash
git clone https://github.com/YOUR-USERNAME/multi-git.git
cd multi-git
npm install
```

Create a focused branch:

```bash
git switch -c fix/short-description
```

Start the Electron application:

```bash
npm run desktop
```

For browser-based development:

```bash
npm start
```

Then open `http://localhost:3000`.

## Project Layout

| Path | Purpose |
| --- | --- |
| `main.js` | Electron lifecycle, windows, and backend startup. |
| `preload.js` | Restricted bridge between Electron and the web UI. |
| `server.js` | Local Express API, Git execution, configuration, vault, and Safety Net. |
| `ssh-config.js` | Management of Multi-Git's block in `~/.ssh/config`. |
| `public/index.html` | Application structure and dialogs. |
| `public/app.js` | Client-side state, rendering, and workflows. |
| `public/style.css` | Application styling. |
| `public/logs.html` | Separate live Terminal Log window. |

The frontend uses plain JavaScript, HTML, and CSS without a compilation step. Please follow the existing structure and naming patterns unless the contribution specifically proposes changing them.

## Coding Guidelines

- Prefer clear, small functions and descriptive names.
- Keep filesystem access restricted to the selected repository where applicable.
- Pass Git arguments as arrays. Do not build shell command strings from user input.
- Validate repository paths, refs, hashes, filenames, and request input at trust boundaries.
- Preserve the localhost-only backend restrictions.
- Never log passphrases, vault keys, private key contents, tokens, or other secrets.
- Keep destructive actions behind explicit confirmation and integrate with Safety Net where appropriate.
- Add accessible labels, titles, focus behavior, and keyboard support for new controls.
- Update documentation when user-visible behavior, requirements, storage, or security behavior changes.
- Avoid adding a runtime dependency when the platform or existing code can solve the problem safely.

Conventional Commit messages are preferred but not required. Examples:

```text
feat(ssh): add profile import
fix(history): preserve graph scroll position
docs: clarify portable installation
```

## Testing Changes

The project does not currently have an automated test suite. Until one is added, every pull request should document the manual checks that were performed.

Use a disposable repository and test the normal path plus relevant failure paths. Depending on the change, this may include:

- a clean repository, modified tracked files, and untracked files;
- stage, unstage, discard, commit, amend, and undo;
- repositories with and without commits or an origin remote;
- SSH and HTTPS remotes;
- System SSH and a selected SSH profile;
- locked and unlocked vault states;
- branches with and without upstream tracking;
- merge, rebase, cherry-pick, or revert conflicts;
- paths containing spaces and non-ASCII characters;
- app restart behavior and persistence;
- Windows installer or portable builds when packaging is affected.

Never test destructive operations against a repository containing work you cannot restore.

Available validation and build commands include:

```bash
npm run desktop
npm start
npm run build-win
npm run build-standalone
```

Generated build output must not be committed.

## Opening a Pull Request

Before submitting:

1. Rebase or merge the current `main` branch as appropriate and resolve conflicts.
2. Review your own diff for unrelated changes, generated output, debugging logs, and sensitive data.
3. Confirm the app starts and the changed workflow works in a disposable repository.
4. Update the README or other documentation when needed.
5. Complete the pull request template, including manual test results and screenshots for visual changes.

Pull requests should explain the problem, the chosen solution, user-visible effects, risks, and how the result was verified. A maintainer may request changes or close a pull request that is out of scope, unsafe, inactive, or inconsistent with the project's direction.

## Issues and Support

Use GitHub Issues for reproducible bugs and focused feature requests. For setup questions and troubleshooting, read the README and [SUPPORT.md](SUPPORT.md) first.

Please be patient. Multi-Git is currently maintained as an open-source project without guaranteed response or resolution times.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
