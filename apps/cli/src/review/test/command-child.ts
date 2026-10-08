import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';

// Test-only transport controls, not normal-runtime environment flags.
const [assets, opener, tty, ...args] = process.argv.slice(2);
const context = createNodeContext(process.stdout, process.stderr);
process.on('message', (message) => {
  if (message === 'SIGINT' || message === 'SIGTERM') process.emit(message);
});
process.exitCode = await executeCli(args, {
  ...context,
  reviewAssetDirectory: assets,
  stderrIsTerminal:
    tty === 'native' ? context.stderrIsTerminal : tty === 'terminal',
  openBrowser(url) {
    process.send?.({ type: 'opened', url });
    return opener === 'fail'
      ? Promise.reject(new Error(url))
      : Promise.resolve();
  },
});
process.disconnect?.();
