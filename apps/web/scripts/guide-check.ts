import { checkGuides } from '@socialprune/core/guide/check';
import { guides } from '../src/app/guide.ts';

const args = process.argv.slice(2).filter((argument) => argument !== '--');
let maxAgeDays = 120;
let release = false;
let valid = true;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--release') release = true;
  else if (args[index] === '--max-age') {
    const value = args[++index];
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      valid = false;
    else maxAgeDays = Number(value);
  } else valid = false;
}
if (!valid) {
  console.error('Usage: guide:check [--max-age <days>] [--release]');
  process.exitCode = 2;
} else {
  const findings = checkGuides(guides, {
    today: new Date().toISOString().slice(0, 10),
    maxAgeDays,
    release,
  });
  for (const finding of findings) console.error(JSON.stringify(finding));
  console.log(
    `Guide check: ${guides.length} guides, ${findings.length} findings, release=${release}.`,
  );
  process.exitCode = findings.length ? 1 : 0;
}
