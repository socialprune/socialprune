import { fileURLToPath } from 'node:url';
import { outputFiles, assertReviewOutput } from '../tooling/review-output.ts';

const files = await outputFiles(
  fileURLToPath(new URL('../dist-review/', import.meta.url)),
);
assertReviewOutput(files);
console.log(
  JSON.stringify({
    localReviewPolicy: true,
    noWorkers: true,
    noBrowserWorkspace: true,
    noManifest: true,
    testEntrypointsAbsent: true,
    files: [...files.keys()],
  }),
);
