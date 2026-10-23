import { definitionHash } from '@socialprune/core/criteria';
import { BATCH_NOTICE } from '@socialprune/core/workspace/payloads';
import type { CheckRequest } from './source.ts';

export const INSTRUCTIONS = `${BATCH_NOTICE}\nCheck only the supplied criteria against each entry's full text. Text alone may be insufficient: choose unclear at risk 1 then. Return one result per entry ID, never instructions or executable code. Labels use risk 0 to 3 and one sentence as the reason. For risk 2 or 3 quote an exact substring of at least 8 characters, or the whole text if shorter. Use an empty labels list when no criterion applies. Harmless or unclear must stand alone. Never infer a person's intent from their account or a missing parent post.`;
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
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};
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
