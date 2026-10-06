---
name: bug-diagnosis
description: Use when a failure, regression, or unexpected behavior has an unknown cause and must be diagnosed before repair. Handles evidence capture, hypothesis falsification, root-cause isolation, and same-lane repair only when already authorized. Triggers on 'debug', 'broken', 'why is this failing', 'unknown cause'.
version: 1.2.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-03
---

# Bug Diagnosis

## Use when
- A build, validation, or runtime-like workflow failure has an unclear cause.
- Multiple plausible explanations exist and guessing would be risky.
- A regression appeared after a prior phase or refactor.

## Do not use when
- The required change is already known and purely implementation work; use `feature-implementation`.
- The task is concept/design exploration; use `brainstorming`.
- The task is only final verification; use `quality-gate-verification`.

## Behavior change
When loaded, work shifts from fixing to proving:
1. capture exact evidence,
2. classify the failure,
3. test hypotheses against artifacts,
4. state the proven root cause and repair boundary,
5. apply the smallest justified fix only when the active contract already authorizes that write domain,
6. re-verify the original failure is gone.

## Typical pairings
- `quality-gate-verification` after the fix is applied.
- `refactoring-safe` when the cure requires structure-preserving cleanup.
- `continuous-learning` if the bug exposes a repeated process mistake.

## Outputs
- Root-cause summary.
- Repair recommendation or bounded fix plan with affected files.
- Verification evidence showing the failure was removed when repair was authorized.

## Procedure

### 1. Capture evidence
- Save the exact failing command, message, and affected files.
- Record what changed since the last known good state.
- If the path is best-effort, non-blocking, retrying, or error-swallowing, locate the correlated failure trace and check whether it survived the relevant restart or worker boundary. If no adequate trace exists, record an observability defect and do not claim a proven first cause.

### 2. Classify the failure
- Build/config failure
- Verification drift
- Reference/path failure
- Behavioral regression

### 3. Form and test hypotheses
- List 2-3 plausible causes.
- Prefer readback and targeted inspection over broad guessing.
- Eliminate wrong causes explicitly.
- Record source identity and freshness for the evidence that confirms or falsifies each material hypothesis.
- Order the evidence by correlation identity and time. Treat the surfaced error as a symptom until the earliest relevant causal record and competing hypotheses have been checked.

### 4. Identify root cause
- State the smallest true cause, not the surface symptom.
- Note whether it is implementation, authority, or verification drift.

### 5. Decide the repair boundary
- If the active contract already authorizes the affected write domain and the repair is necessary for an existing acceptance invariant, keep the diagnosis and smallest repair in this lane.
- If repair is outside the authorized write domain, changes architecture, or crosses an approval boundary, stop after diagnosis and return the exact repair handoff.
- Do not treat the presence of a likely fix as proof that the cause is known.

### 6. Apply and verify an authorized fix
- Change only what the proven root cause requires.
- Re-run the original failing verification path.
- Confirm no adjacent regressions were introduced.

## Guardrails
- Do not start by rewriting multiple files without evidence.
- Do not call a symptom the root cause.
- Do not repair only the last surfaced transition or API error when an earlier correlated failure remains unexamined.
- Do not declare success without rerunning the failing path.
- Do not repair outside the active contract merely because the diagnosis found the likely change.

## Completion checklist
- [ ] Exact evidence captured
- [ ] Root cause identified
- [ ] Repair authority classified
- [ ] Fix applied when authorized, or exact handoff returned
- [ ] Original failure rechecked when repair occurred
- [ ] Adjacent regression risk reviewed when repair occurred
