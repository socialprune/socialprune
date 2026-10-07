import { executeCli } from './cli/adapter.ts';
import { createNodeContext } from './cli/node-context.ts';

if (import.meta.main) {
  process.exitCode = await executeCli(
    process.argv.slice(2),
    createNodeContext(process.stdout, process.stderr),
  );
}
