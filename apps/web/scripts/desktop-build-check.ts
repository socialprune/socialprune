import { fileURLToPath } from 'node:url';
import { outputFiles } from '../tooling/review-output.ts';
import { assertDesktopOutput } from '../tooling/desktop-build-output.ts';

const files = await outputFiles(
  fileURLToPath(new URL('../dist-desktop/', import.meta.url)),
);
assertDesktopOutput(files);
console.log(
  JSON.stringify({
    desktopPolicy: true,
    noWorkers: true,
    noWebAssembly: true,
    testEntrypointsAbsent: true,
    files: [...files.keys()],
  }),
);
