// Splits a conflicted working-tree file into ordinary text and conflict groups
// so the editor can offer "keep ours" / "keep theirs" per group.
import type { ConflictFileBlock } from '../../shared/git-types';

type ParserState = 'normal' | 'ours' | 'theirs';

export function parseConflictBlocks(content: string): ConflictFileBlock[] {
  const blocks: ConflictFileBlock[] = [];

  let normalLines: string[] = [];
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let state: ParserState = 'normal';

  const flushNormal = (): void => {
    if (normalLines.length > 0) {
      blocks.push({ type: 'normal', text: normalLines.join('\n') });
      normalLines = [];
    }
  };

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('<<<<<<<')) {
      flushNormal();
      state = 'ours';
      oursLines = [];
      continue;
    }

    if (line.startsWith('=======')) {
      if (state === 'ours') {
        state = 'theirs';
        theirsLines = [];
      } else {
        // A row of equals signs outside a conflict is just text.
        normalLines.push(line);
      }
      continue;
    }

    if (line.startsWith('>>>>>>>')) {
      if (state === 'theirs') {
        blocks.push({
          type: 'conflict',
          ours: oursLines.join('\n'),
          theirs: theirsLines.join('\n'),
          info: line.substring(7).trim()
        });
        state = 'normal';
      } else {
        normalLines.push(line);
      }
      continue;
    }

    if (state === 'ours') {
      oursLines.push(line);
    } else if (state === 'theirs') {
      theirsLines.push(line);
    } else {
      normalLines.push(line);
    }
  }

  flushNormal();

  return blocks;
}
