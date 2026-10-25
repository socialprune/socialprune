import type { ListTimeoutDiagnostic } from './report.ts';

/** Candidate IG-18: opaque markup can stay manual, never prove a match/absence. */
export function listImageOnlyManual(value: ListTimeoutDiagnostic): boolean {
  return (
    value.rowsObserved &&
    !value.observationFailed &&
    value.imageOnlyRows > 0 &&
    !value.statusElementPresent &&
    !value.busyElementPresent &&
    value.filter.applied &&
    value.filter.readbackObserved &&
    value.filter.startMatches &&
    value.filter.endMatches &&
    value.dom.observed &&
    value.dom.lastChangeAfterApplyMs !== null &&
    value.dom.observedForMs - value.dom.lastChangeAfterApplyMs >= 500
  );
}
