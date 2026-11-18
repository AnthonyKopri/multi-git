// Runs in an Electron utility process, started by terminal-follow.ts.
//
// Copying the terminal edition is a recursive copy of a Node runtime and the
// toolkit, followed by a run of the copied Node to check it. On the main
// process that would freeze every window for a second or more just after
// launch, so it happens here instead.
//
// The payload's path is the only argument, and it is the one the main process
// found inside its own build. Nothing from a page reaches this.
import { activatePayload } from '../../server/terminal/install';

interface ParentPort {
  postMessage(message: unknown): void;
}

const port = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
const source = process.argv[2];

function reply(message: { ok: true; version: string | null } | { ok: false; message: string }): void {
  port?.postMessage(message);
}

try {
  if (!source) {
    throw new Error('No terminal edition payload was named.');
  }
  reply({ ok: true, version: activatePayload(source).installedVersion });
} catch (error) {
  reply({ ok: false, message: error instanceof Error ? error.message : String(error) });
}
