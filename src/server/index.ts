// Server entry point.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createApp } from './app';
import { openUrlInBrowser } from './os/browser';

export { createApp } from './app';

const DEFAULT_PORT = Number(process.env['PORT']) || 3000;

export interface StartServerOptions {
  /** 0 asks the OS for any free port, which desktop mode relies on. */
  port?: number;
  openBrowser?: boolean;
}

export function startServer(options: StartServerOptions = {}): Promise<Server> {
  const port = options.port ?? DEFAULT_PORT;
  const isElectron = Boolean(
    process.versions.electron || process.env['IS_ELECTRON'] === 'true'
  );
  const shouldOpenBrowser = options.openBrowser ?? !isElectron;

  const app = createApp();

  return new Promise((resolve, reject) => {
    // Loopback only. This API runs git commands and reads files, so it must
    // never be reachable from another machine on the network.
    const server = app.listen(port, '127.0.0.1', () => {
      const actualPort = (server.address() as AddressInfo).port;
      const url = `http://localhost:${actualPort}`;
      console.log(`Server started on ${url}`);

      if (isElectron && !shouldOpenBrowser) {
        console.log('Running in Electron. Skipping browser autostart.');
      }

      if (shouldOpenBrowser) {
        openUrlInBrowser(url);
      }

      resolve(server);
    });

    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((error: Error) => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  });
}
