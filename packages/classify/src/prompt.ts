import { definitionHash } from '@socialprune/core/criteria';
import { BATCH_NOTICE } from '@socialprune/core/workspace/payloads';
import type { CheckRequest } from './source.ts';

export const INSTRUCTIONS = `${BATCH_NOTICE}\nCheck the full text against only the supplied criteria. No original post or conversation context is supplied, even for replies and quotes; never invent it or intent. If context is needed, use unclear risk 1, quote null. Return one result per supplied ID, compact JSON only. Emit only applicable criterion IDs, each once; no label per non-hit, and [] if none applies. Harmless or unclear stands alone. Risk is 0 to 3. Reason: one brief sentence on one line, preferably under 120 characters, maximum 300; no line breaks or .!? followed by whitespace and another word, including abbreviations. Do not repeat text in reasons. Risk 2/3 needs an exact substring of that entry's text, at least 8 characters or the entire text if shorter; copy the shortest sufficient quote, never paraphrase, ellipses or a parent post. Never lower risk merely to omit a quote.`;
export const ANSWER_FORMAT =
  '{"results":[{"id":"e1","labels":[]},{"id":"e2","labels":[{"category":"<criterion id>","risk":2,"quote":"<exact words>","reason":"<one sentence>"}]}]}';
export const RUBRIC_VERSION = definitionHash(
  INSTRUCTIONS + '\n' + ANSWER_FORMAT,
)
  .replace(/^sha256:/, '')
  .slice(0, 12);
export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'labels'],
        properties: {
          id: { type: 'string', pattern: '^e[1-9][0-9]*$' },
          labels: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['category', 'risk', 'quote', 'reason'],
              properties: {
                category: { type: 'string' },
                risk: { type: 'integer', minimum: 0, maximum: 3 },
                quote: { type: ['string', 'null'] },
                reason: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 300,
                  pattern: '^[^\\r\\n]+$',
                },
              },
            },
          },
        },
      },
    },
  },
};
/** Stable for a criteria group; entry IDs never become an enum or change the prefix. */
export function answerSchema(request: Pick<CheckRequest, 'criteria'>) {
  const schema = structuredClone(ANSWER_SCHEMA);
  const labels = schema.properties.results.items.properties.labels;
  return {
    ...schema,
    properties: {
      results: {
        ...schema.properties.results,
        items: {
          ...schema.properties.results.items,
          properties: {
            ...schema.properties.results.items.properties,
            labels: {
              ...labels,
              maxItems: request.criteria.length,
              items: {
                ...labels.items,
                properties: {
                  ...labels.items.properties,
                  category: {
                    type: 'string',
                    enum: [
                      ...request.criteria
                        .map((criterion) => criterion.id)
                        .sort(),
                      'harmless',
                      'unclear',
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
export function prefix(request: Pick<CheckRequest, 'criteria'>) {
  return (
    INSTRUCTIONS +
    '\nCriteria:\n' +
    JSON.stringify(
      [...request.criteria].sort((a, b) => a.id.localeCompare(b.id)),
    ) +
    '\nAnswer format:\n' +
    ANSWER_FORMAT
  );
}
