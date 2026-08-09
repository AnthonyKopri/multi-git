// External tools, as both sides describe them.
//
// The sibling of ./agent-types.ts. It lives here rather than beside the server
// module that produces it because the renderer shows the detection results, and
// importing a server module into the web build drags Node's types in with it.
import type { ExternalToolKind } from './config-types';

/** A known tool found on PATH, offered as a starting point for a definition. */
export interface DetectedTool {
  id: string;
  kind: ExternalToolKind;
  label: string;
  executable: string;
  /** The argument template this build believes the tool wants. Editable. */
  args: string[];
  /** Where it resolved to, so the user can see which copy was found. */
  resolvedPath: string;
  /** True when a definition for this executable and kind already exists. */
  configured: boolean;
}

/** The placeholders an argument template may use, and what each one means. */
export const TOOL_PLACEHOLDER_HELP: readonly { name: string; meaning: string }[] = [
  { name: '{local}', meaning: 'Our side of a merge, or the left side of a diff' },
  { name: '{remote}', meaning: 'Their side' },
  { name: '{base}', meaning: 'The common ancestor, for a three-way merge' },
  { name: '{merged}', meaning: 'Where a merge tool should write its result' },
  { name: '{path}', meaning: 'A single file, for an editor' },
  { name: '{line}', meaning: 'A line number, for an editor that takes one' },
  { name: '{cwd}', meaning: 'The working directory, for a terminal or file manager' }
];
