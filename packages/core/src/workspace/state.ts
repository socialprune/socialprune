import type {
  Assessment,
  DecisionEvent,
  DecisionValue,
  OutcomeEvent,
  OutcomeValue,
  WorkspaceV2,
} from '../model/index.ts';
import { WorkspaceError } from './errors.ts';

export interface DerivedItemState {
  decision: DecisionValue;
  outcome: OutcomeValue;
  assessments: Assessment[];
}
export function deriveState(
  workspace: Pick<
    WorkspaceV2,
    'items' | 'assessments' | 'decisionEvents' | 'outcomeEvents'
  >,
): Map<string, DerivedItemState> {
  const state = new Map<string, DerivedItemState>(
    workspace.items.map((item) => [
      item.id,
      { decision: 'undecided', outcome: 'unknown', assessments: [] },
    ]),
  );
  const assessments = new Map<string, Map<string, Assessment>>();
  for (const assessment of workspace.assessments) {
    if (!state.has(assessment.itemId)) throw new WorkspaceError('UNKNOWN_ITEM');
    const sources =
      assessments.get(assessment.itemId) ?? new Map<string, Assessment>();
    sources.set(
      JSON.stringify([assessment.source.kind, assessment.source.name]),
      assessment,
    );
    assessments.set(assessment.itemId, sources);
  }
  for (const [id, sources] of assessments)
    state.get(id)!.assessments = [...sources.values()];
  applyEvents(workspace.decisionEvents, state, 'decision', 'undecided');
  applyEvents(workspace.outcomeEvents, state, 'outcome', 'unknown');
  return state;
}
function applyEvents(
  events: readonly (DecisionEvent | OutcomeEvent)[],
  states: Map<string, DerivedItemState>,
  field: 'decision' | 'outcome',
  initial: DecisionValue | OutcomeValue,
): void {
  const values = new Map<string, DecisionValue | OutcomeValue>();
  for (const event of events) {
    const state = states.get(event.itemId);
    if (!state) throw new WorkspaceError('UNKNOWN_ITEM');
    if (event.previous !== (values.get(event.itemId) ?? initial))
      throw new WorkspaceError('EVENT_CHAIN');
    values.set(event.itemId, event.value);
    if (field === 'decision') state.decision = event.value as DecisionValue;
    else state.outcome = event.value as OutcomeValue;
  }
}
