// Starts the server from a command line: `npm start` and `npm run dev`.
//
// Kept apart from src/server/index.ts so that starting a server is a side
// effect only this file has. index.ts is imported by the Electron main
// process and inlined into its bundle, where any top-level start would run a
// second time.
import { startServer } from './index';

startServer().catch((error: Error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
