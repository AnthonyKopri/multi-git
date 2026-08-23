// The shape of a Terminal Log entry, shared by the side that records one and
// the side that draws it.
//
// The server is the author for anything with a `command`: it is the only place
// that knows the argument vector that actually ran, which is what makes the log
// worth trusting. The renderer still writes the narrative lines, which have no
// `command` because there was no invocation -- only a reason.

export type LogType = 'error' | 'success' | 'cmd' | 'info';

/**
 * Whether an invocation read the repository or changed it.
 *
 * A refresh runs upwards of forty git commands and nearly all are questions, so
 * the view hides reads unless they are asked for. Nothing is left out of the
 * record; this only decides what is on the first screen.
 */
export type CommandKind = 'read' | 'write';

/** What actually ran, for an entry that describes a command. */
export interface LogCommand {
  /** The real argument vector, executable first. Runnable as it stands. */
  argv: string[];
  cwd: string;
  /**
   * Only the environment this application added -- GIT_SSH_COMMAND and the
   * askpass bridge. The inherited environment is the user's own and is not
   * theirs to be shown back at them.
   */
  env?: Record<string, string>;
  kind: CommandKind;
  durationMs?: number;
  exitCode?: number;
}

export interface LogEntry {
  /** Monotonic within a server run. Readers order by this, not by `ts`. */
  seq: number;
  ts: number;
  type: LogType;
  text: string;
  /**
   * The repository this line belongs to, when it belongs to one.
   *
   * Several windows share one buffer, so without it a line from one repository
   * is indistinguishable from a line from another -- which in an application
   * built around having several open at once made the log unusable for the
   * exact case it was most needed.
   */
  repoPath?: string;
  command?: LogCommand;
}
