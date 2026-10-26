import { PRESETS, definitionHash } from '@socialprune/core/criteria';
import type { SuggestionSource } from './source.ts';
import { runBatches } from './runner.ts';
import type { RunEntry, RunProgress } from './runner.ts';
import { prefix } from './prompt.ts';

export function generatedEntries(count = 1000): RunEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const text = `Generated batch measurement entry ${index + 1}: I liked the invented museum's blue exhibition today.`;
    return {
      itemId: `x:generated-${index + 1}`,
      contentHash: definitionHash(text),
      platform: index % 2 ? 'instagram' : 'x',
      kind: index % 2 ? 'comment' : 'post',
      text,
    };
  });
}
export async function measureBatches(options: {
  source: SuggestionSource;
  answeringModel: string;
  confirmedOrigin: string;
  signal: AbortSignal;
  progress?: (value: RunProgress) => void;
}) {
  const entries = generatedEntries();
  const criteria = PRESETS.filter(
    (c) => !['harmless', 'unclear'].includes(c.id),
  );
  const results = [];
  for (const entriesPerRequest of [10, 25, 50]) {
    const result = await runBatches({
      ...options,
      entries,
      criteria,
      entriesPerRequest,
      parallelRequests: 1,
      submit: () => Promise.resolve(),
    });
    results.push({
      entriesPerRequest,
      entries: result.stored,
      requests: result.requests,
      tokens: result.tokens,
      missingIds: result.missingIds,
      truncatedAnswers: result.truncatedAnswers,
      normalization: result.diagnostics,
      prefixCharacters: prefix({ criteria }).length,
      // Chat-completions usage does not expose tokens of the system message alone.
      prefixTokens: null,
    });
  }
  return {
    generated: true,
    results,
    measuredDefault:
      results
        .filter(
          (result) => result.entries === 1000 && result.truncatedAnswers === 0,
        )
        .at(-1)?.entriesPerRequest ?? null,
    prefixTokens: {
      value: null,
      reason:
        'The endpoint usage fields do not separate prefix tokens from entry tokens',
    },
    documentedCacheMinimums: {
      observedOn: '2026-10-21',
      openai: 1024,
      anthropicOpus: 512,
    },
  };
}
