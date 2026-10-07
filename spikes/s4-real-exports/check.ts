import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkInputs } from './report.ts';
import { validateReport } from './schema.ts';

export interface Output { stdout(text: string): void; stderr(code: string): void }
export function printReport(value: unknown, output: Output): 0 | 1 {
  let serialized: string;
  try {
    validateReport(value);
    serialized = JSON.stringify(value);
    validateReport(JSON.parse(serialized) as unknown);
  } catch {
    output.stderr('S4_REPORT_INVALID\n');
    return 1;
  }
  output.stdout(serialized + '\n');
  return 0;
}
export async function run(args: string[], output: Output): Promise<0 | 1> {
  if (!args.length) { output.stderr('S4_USAGE\n'); return 1; }
  try { return printReport(await checkInputs(args), output); }
  catch { output.stderr('S4_CHECK_FAILED\n'); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2), {
    stdout: (text) => { process.stdout.write(text); },
    stderr: (code) => { process.stderr.write(code); },
  });
}
