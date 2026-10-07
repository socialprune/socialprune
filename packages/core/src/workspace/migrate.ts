import { WorkspaceSchema as WorkspaceV1Schema } from '../model/v1.ts';
import type { Workspace as WorkspaceV1 } from '../model/v1.ts';
import type {
  Assessment,
  DecisionEvent,
  OutcomeEvent,
  WorkspaceV2,
} from '../model/index.ts';
import { WorkspaceError } from './errors.ts';
import { validateWorkspace, workspaceCounts } from './validation.ts';

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
export async function migrateV1(input: unknown): Promise<WorkspaceV2> {
  const result = WorkspaceV1Schema.safeParse(input);
  if (!result.success) throw new WorkspaceError('INVALID_WORKSPACE');
  const old: WorkspaceV1 = result.data;
  for (const item of old.items)
    if (!item.id.startsWith(`${item.platform}:`))
      throw new WorkspaceError('INVALID_ITEM_ID');
  const decisions: DecisionEvent[] = [];
  const outcomes: OutcomeEvent[] = [];
  const assessments: Assessment[] = [];
  const lastDecision = new Map<string, DecisionEvent['value']>();
  const lastOutcome = new Map<string, OutcomeEvent['value']>();
  // V1 recorded no cross-log order. Timestamp, decision-before-outcome ties
  // and original array index are the only evidence available for migration.
  const events = [
    ...old.decisions.map((record, index) => ({
      kind: 'decision' as const,
      record,
      index,
      at: record.decidedAt,
    })),
    ...old.outcomes.map((record, index) => ({
      kind: 'outcome' as const,
      record,
      index,
      at: record.recordedAt,
    })),
  ].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      (a.kind === b.kind ? a.index - b.index : a.kind === 'decision' ? -1 : 1),
  );
  let seq = 0;
  for (const event of events) {
    const { record, index } = event;
    const eventId = `v1-${await hash(JSON.stringify([event.kind, index, record]))}`;
    const action = {
      id: eventId,
      kind: 'migrated' as const,
      size: 1,
      reverts: null,
    };
    if (event.kind === 'decision') {
      const value = record as WorkspaceV1['decisions'][number];
      const previous = lastDecision.get(value.itemId) ?? 'undecided';
      decisions.push({ ...value, eventId, seq: ++seq, previous, action });
      lastDecision.set(value.itemId, value.value);
    } else {
      const value = record as WorkspaceV1['outcomes'][number];
      const previous = lastOutcome.get(value.itemId) ?? 'unknown';
      outcomes.push({
        ...value,
        eventId,
        seq: ++seq,
        previous,
        source: { kind: 'human', via: 'v1-unrecorded' },
        action,
      });
      lastOutcome.set(value.itemId, value.value);
    }
  }
  for (const [index, record] of old.assessments.entries())
    assessments.push({
      ...record,
      assessmentId: `v1-${await hash(JSON.stringify([index, record]))}`,
      submissionId: null,
    });
  const arrays = {
    imports: old.imports.map((record) => ({
      ...record,
      status: 'complete' as const,
    })),
    items: old.items.map((item) => ({ ...item, mediaCount: null })),
    submissions: [],
    assessments,
    decisionEvents: decisions,
    outcomeEvents: outcomes,
  };
  return validateWorkspace({
    format: 'socialprune-workspace',
    schemaVersion: 2,
    id: `v1-${await hash(old.createdAt + old.imports.map((record) => record.id).join(''))}`,
    kind: 'personal',
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
    lastBackupAt: null,
    settings: { categories: old.settings.categories, timeZone: null },
    counts: workspaceCounts(arrays),
    ...arrays,
  });
}
