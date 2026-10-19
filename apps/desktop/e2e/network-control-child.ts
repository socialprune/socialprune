import { createServer } from 'node:net';
import { once } from 'node:events';

// Explicit test entrypoint only. Run by a copied Node, never the app entry.
const server = createServer();
server.listen(4669, '127.0.0.1');
await once(server, 'listening');
console.log('CONTROL_LISTENING');
process.stdin.once('data', () => {
  server.close();
});
process.stdin.resume();
