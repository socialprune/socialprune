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
  for (const [index, record] of old.decisions.entries()) {
    const eventId = `v1-${await hash(JSON.stringify([index, record]))}`;
    const previous = lastDecision.get(record.itemId) ?? 'undecided';
    decisions.push({
      ...record,
      eventId,
      previous,
      action: { id: eventId, kind: 'migrated', size: 1, reverts: null },
    });
    lastDecision.set(record.itemId, record.value);
  }
  for (const [index, record] of old.outcomes.entries()) {
    const eventId = `v1-${await hash(JSON.stringify([index, record]))}`;
    const previous = lastOutcome.get(record.itemId) ?? 'unknown';
    outcomes.push({
      ...record,
      eventId,
      previous,
      source: { kind: 'human', via: 'v1-unrecorded' },
      action: { id: eventId, kind: 'migrated', size: 1, reverts: null },
    });
    lastOutcome.set(record.itemId, record.value);
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
