// Picks the OpenSSH binaries that can actually reach this machine's agent.
//
// Windows has two unrelated OpenSSH builds installed side by side, and they do
// not share an agent:
//
//   * Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`) talks to the
//     OpenSSH Authentication Agent service over the named pipe
//     `\\.\pipe\openssh-ssh-agent`. This is the agent this app loads keys into,
//     the one `Load all keys` fills, and the one Windows starts at boot.
//   * The MSYS build shipped inside Git for Windows
//     (`C:\Program Files\Git\usr\bin\ssh.exe`) speaks the Unix-socket protocol
//     and finds an agent through `SSH_AUTH_SOCK`. It cannot see the named pipe
//     at all: `ssh-add -l` against it answers "Could not open a connection to
//     your authentication agent".
//
// Both are called `ssh`, and which one a bare `ssh` resolves to is decided by
// PATH order, which differs between this app, a terminal, and CI. When the
// MSYS one wins, every key the user loaded into the agent is invisible, ssh
// falls back to reading the private key file, and a passphrase is demanded for
// a key that is already unlocked and sitting in the agent.
//
// So the binary is named rather than left to PATH. One family, one agent.
import fs from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';

/** Cached because this is asked once per git command and the answer cannot change. */
const resolved = new Map<string, string>();

/**
 * The System32 copy of an OpenSSH tool, when this is Windows and it is there.
 *
 * `SystemRoot` rather than a hard-coded `C:\Windows`: Windows is not always
 * installed on C:, and a wrong absolute path here would be worse than falling
 * back to PATH.
 */
function windowsOpenSsh(tool: string): string | null {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir'];
  if (!systemRoot) {
    return null;
  }

  const candidate = path.join(systemRoot, 'System32', 'OpenSSH', `${tool}.exe`);
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * The command to run for an OpenSSH tool: an absolute path on Windows when the
 * agent-capable build is present, and the bare name everywhere else.
 */
export function opensshBinary(tool: 'ssh' | 'ssh-add' | 'ssh-keygen'): string {
  const cached = resolved.get(tool);
  if (cached !== undefined) {
    return cached;
  }

  const answer = (isWindows ? windowsOpenSsh(tool) : null) ?? tool;
  resolved.set(tool, answer);
  return answer;
}

/**
 * The same path, quoted for `GIT_SSH_COMMAND`.
 *
 * Git splits that variable with shell-like quoting rules before spawning, so an
 * unquoted `C:\Program Files\...` would arrive as two arguments. Forward
 * slashes because the value is parsed by that same shell-like splitter, which
 * treats a backslash as an escape.
 */
export function sshCommandPrefix(): string {
  const binary = opensshBinary('ssh');
  return binary === 'ssh' ? 'ssh' : `"${binary.replace(/\\/g, '/')}"`;
}

/** Test seam: forgets the cached answers. */
export function resetOpensshPathCache(): void {
  resolved.clear();
}
