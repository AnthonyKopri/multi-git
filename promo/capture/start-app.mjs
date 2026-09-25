// Starts Multi-Git's browser mode on 127.0.0.1:4173 with the isolated
// environment and the fake home, then returns (the server keeps running).
//   node capture/start-app.mjs          start
//   node capture/start-app.mjs --stop   stop it
import { startServer, stopServer, BASE } from './lib.mjs';

await stopServer();
if (!process.argv.includes('--stop')) {
  await startServer();
  console.log(`Multi-Git browser mode is up at ${BASE}`);
}
