import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import { testIpc } from './ipc.ts';

// Test-only transport controls, not normal-runtime environment flags.
const [assets, opener, tty, ...args] = process.argv.slice(2);
const context = createNodeContext(process.stdout, process.stderr);
const ipc = testIpc();
process.on('message', (message) => {
  if (message === 'SIGINT' || message === 'SIGTERM') process.emit(message);
});
process.exitCode = await executeCli(args, {
  ...context,
  reviewAssetDirectory: assets,
  stderrIsTerminal:
    tty === 'native' ? context.stderrIsTerminal : tty === 'terminal',
  async openBrowser(url) {
    await ipc.send({ type: 'opened', url });
    if (opener === 'fail') throw new Error(url);
  },
});
await ipc.disconnect();
