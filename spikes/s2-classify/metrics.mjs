import { DEFAULT_CATEGORIES, validateLabels, AssessmentSchema } from './contract.mjs';

export function metrics(results, items, labels) {
  if (results.set !== 'eval') throw new Error('Smoke proves wiring only; quality metrics require an eval result');
  validateLabels(items, labels);
  if (results.rows.length !== items.length || new Set(results.rows.map(row => row.itemId)).size !== items.length) throw new Error('Incomplete or duplicate result rows');
  const expected = new Map(labels.map(row => [row.itemId, row]));
  const counts = Object.fromEntries(DEFAULT_CATEGORIES.map(category => [category, { tp: 0, fp: 0, fn: 0, support: 0 }]));
  let riskEqual = 0;
  for (const row of results.rows) {
    AssessmentSchema.parse(row.assessment);
    const truth = expected.get(row.itemId);
    if (!truth || row.itemId !== row.assessment.itemId || !counts[row.assessment.category]) throw new Error('Result item/category mismatch');
    counts[truth.category].support++;
    if (row.assessment.category === truth.category) counts[truth.category].tp++;
    else { counts[row.assessment.category].fp++; counts[truth.category].fn++; }
    if (row.assessment.risk === truth.risk) riskEqual++;
  }
  const n = results.rows.length;
  const rates = summary(results.rows);
  return { tier: results.tier, model: results.modelIdentity, count: n,
    perCategory: Object.fromEntries(Object.entries(counts).map(([category, count]) => [category, { ...count,
      precision: count.tp + count.fp ? count.tp / (count.tp + count.fp) : null,
      recall: count.tp + count.fn ? count.tp / (count.tp + count.fn) : null }])), riskAgreement: riskEqual / n, ...rates };
}
export function summary(rows) {
  const n = rows.length;
  if (!n) throw new Error('No result rows');
  const latency = rows.map(row => row.latencyMs).sort((a, b) => a - b);
  if (latency.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid latency');
  return { unclearRate: rows.filter(row => row.assessment.category === 'unclear').length / n,
    invalidRate: rows.filter(row => row.invalid).length / n,
    nonVerbatimRate: rows.filter(row => row.nonVerbatim).length / n,
    latencyMs: { mean: latency.reduce((a, b) => a + b, 0) / n, median: latency[Math.ceil(n / 2) - 1],
      p95: latency[Math.ceil(n * .95) - 1], min: latency[0], max: latency.at(-1) } };
}
