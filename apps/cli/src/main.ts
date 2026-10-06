import { parseArgs } from 'node:util';
import { helpText } from './index.ts';

try {
  const { values, positionals } = parseArgs({
    options: { help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(helpText());
  } else {
    console.error('Commands are not available yet. Use --help.');
    process.exitCode = 2;
  }
} catch {
  console.error('Invalid arguments. Use --help.');
  process.exitCode = 2;
}
