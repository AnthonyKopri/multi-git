// One argv word embedded in a command string another program gives to a shell.
//
// Most processes in this application are spawned with an argument vector and
// never need this. Git's GIT_EDITOR, GIT_SSH_COMMAND and core.sshCommand are
// exceptions: Git deliberately interprets those values as command strings.

/** Quotes one literal value for the host shell Git uses. */
export function quoteShellArgument(
  value: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    // A Windows path cannot contain a quote. Double quotes preserve spaces for
    // the native Git/SSH command path while keeping the existing config form.
    return `"${value.replace(/"/g, '')}"`;
  }

  // POSIX single quotes suppress parameter expansion, command substitution,
  // backticks and globbing. End/reopen around a literal apostrophe.
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
