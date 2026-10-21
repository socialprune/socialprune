import type { Assessment, Item } from '../model/index.ts';
import { PRESETS, definitionHash } from './presets.ts';

const at = '2026-10-20T12:00:00.000Z';
const source = { kind: 'model' as const, name: 'generated', version: null };
export function generatedItem(id = 'x:1', likes: number | null = 0): Item {
  return {
    id,
    platform: 'x',
    account: { key: 'x:generated', handle: null },
    kind: 'post',
    text: 'Generated content',
    createdAt: at,
    engagement: { likes, reposts: 0 },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    mediaCount: null,
    url: null,
    provenance: { archive: 'generated', file: 'generated.json', index: 0 },
  };
}
export function generatedLabel(
  id: string,
  category: string,
  submissionId: string | null = null,
  itemId = 'x:1',
  risk = 2,
): Assessment {
  return {
    assessmentId: id,
    submissionId,
    itemId,
    category,
    risk,
    source,
    reason: 'Generated reason.',
    evidence: null,
    confidence: null,
    createdAt: at,
  };
}
export function generatedRun(id: string, criteria: string[], labelCount = 1) {
  return {
    submissionId: id,
    contentHash: definitionHash(id),
    source,
    receivedAt: at,
    labelCount,
    criteria: criteria.map((id) => ({
      id,
      hash: PRESETS.find((preset) => preset.id === id)!.hash,
    })),
  };
}
