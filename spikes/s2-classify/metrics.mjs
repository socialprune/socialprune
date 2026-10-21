import { DEFAULT_CATEGORIES, validateLabels, validateSelections, AssessmentSchema } from './contract.mjs';

export function wilson(successes, trials) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < successes) throw new Error('Invalid binomial counts');
  if (!trials) return null;
  const z = 1.959963984540054, z2 = z * z, p = successes / trials;
  const centre = (p + z2 / (2 * trials)) / (1 + z2 / trials);
  const half = z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / (1 + z2 / trials);
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), confidence: .95 };
}

export function metrics(results, items, labels) {
  if (results.set !== 'eval') throw new Error('Smoke proves wiring only; quality metrics require an eval result');
  validateLabels(items, labels);
  if (results.rows.length !== items.length || new Set(results.rows.map(row => row.itemId)).size !== items.length) throw new Error('Incomplete or duplicate result rows');
  const expected = new Map(labels.map(row => [row.itemId, row]));
  const counts = Object.fromEntries(DEFAULT_CATEGORIES.map(category => [category, { tp: 0, fp: 0, fn: 0, support: 0 }]));
  let riskEqual = 0, matchedLabels = 0, exactSetEqual = 0;
  for (const row of results.rows) {
    if (!Array.isArray(row.assessments)) throw new Error('Multi-label assessments required');
    row.assessments.forEach(value => AssessmentSchema.parse(value));
    validateSelections(row.assessments.map(({ category, risk }) => ({ category, risk })));
    const truth = expected.get(row.itemId);
    if (!truth || row.assessments.some(value => value.itemId !== row.itemId)) throw new Error('Result item/category mismatch');
    const actual = new Map(row.assessments.map(value => [value.category, value.risk]));
    const wanted = new Map(truth.labels.map(value => [value.category, value.risk]));
    if (actual.size === wanted.size && [...wanted.keys()].every(category => actual.has(category))) exactSetEqual++;
    for (const category of DEFAULT_CATEGORIES) {
      if (wanted.has(category)) { counts[category].support++; counts[category][actual.has(category) ? 'tp' : 'fn']++; }
      else if (actual.has(category)) counts[category].fp++;
      if (wanted.has(category) && actual.has(category)) { matchedLabels++; if (wanted.get(category) === actual.get(category)) riskEqual++; }
    }
  }
  const n = results.rows.length;
  const rates = summary(results.rows);
  return { tier: results.tier, model: results.modelIdentity, count: n,
    perCategory: Object.fromEntries(Object.entries(counts).map(([category, count]) => [category, { ...count,
      precision: count.tp + count.fp ? count.tp / (count.tp + count.fp) : null,
       recall: count.tp + count.fn ? count.tp / (count.tp + count.fn) : null,
       precisionWilson95: wilson(count.tp, count.tp + count.fp), recallWilson95: wilson(count.tp, count.tp + count.fn) }])),
     exactCategorySetAgreement: exactSetEqual / n, riskAgreement: matchedLabels ? riskEqual / matchedLabels : null,
     riskAgreementDenominator: matchedLabels, riskAgreementBasis: 'matched item/category pairs only', ...rates };
}
export function summary(rows) {
  const n = rows.length;
  if (!n) throw new Error('No result rows');
  const latency = rows.map(row => row.latencyMs).sort((a, b) => a - b);
  if (latency.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid latency');
  return { unclearRate: rows.filter(row => row.assessments.some(value => value.category === 'unclear')).length / n,
    invalidRate: rows.filter(row => row.invalid).length / n,
    nonVerbatimRate: rows.filter(row => row.nonVerbatim).length / n,
    latencyMs: { mean: latency.reduce((a, b) => a + b, 0) / n, median: latency[Math.ceil(n / 2) - 1],
      p95: latency[Math.ceil(n * .95) - 1], min: latency[0], max: latency.at(-1) } };
}
