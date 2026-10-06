import { runGuard } from './run.ts';

process.exitCode = await runGuard(process.argv.slice(2));
