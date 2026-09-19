import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appRoot } from '../app-root';

/** Unix permits unlinking running programs, so file locks cannot detect users. */
export function holdPayloadSession(payload = appRoot()): () => void {
  if (path.basename(path.dirname(payload)) !== 'versions') return () => {};
  const directory = path.join(path.dirname(path.dirname(payload)), '.sessions', path.basename(payload));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const marker = path.join(directory, `${process.pid}-${randomUUID()}.json`);
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  const release = (): void => { fs.rmSync(marker, { force: true }); };
  process.once('exit', release);
  return () => { process.off('exit', release); release(); };
}

export function payloadInUse(root: string, version: string): boolean {
  const directory = path.join(root, '.sessions', version);
  if (!fs.existsSync(directory)) return false;
  for (const file of fs.readdirSync(directory)) {
    const marker = path.join(directory, file);
    try {
      const { pid } = JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid: number };
      if (!Number.isInteger(pid) || pid <= 0) return true;
      try { process.kill(pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true; }
      fs.rmSync(marker, { force: true });
    } catch { return true; }
  }
  fs.rmdirSync(directory);
  return false;
}
