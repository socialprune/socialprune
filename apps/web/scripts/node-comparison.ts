import { importArchive } from '@socialprune/core';
import type { Item } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { xAdapter } from '@socialprune/adapter-x';

const archive = process.argv[2];
if (!archive) throw new Error('Pass the generated measurement ZIP.');
const items: Item[] = [];
const baselineRss = process.memoryUsage().rss;
let peakRss = baselineRss;
let samples = 0;
const timer = setInterval(() => {
  samples++;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);
const start = performance.now();
const reader = await openArchivePaths([archive]);
try {
  const summary = await importArchive(reader, [xAdapter], {
    onItems: (batch) => {
      items.push(...batch);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    },
  });
  if (items.length !== 100_000 || summary.status !== 'ok')
    throw new Error('Node comparison did not import 100000 items.');
  console.log(
    JSON.stringify({
      name: 'M4',
      status: summary.status,
      items: items.length,
      wallMs: performance.now() - start,
      baselineRss,
      peakRss,
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
      samples,
    }),
  );
} finally {
  clearInterval(timer);
  await reader.close();
}
