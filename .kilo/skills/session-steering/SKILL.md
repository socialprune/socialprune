---
name: session-steering
description: Use when the operator has explicitly authorized Agent Manager sessions and this session must cut, dispatch, monitor, and merge work owned by sibling sessions. Handles the sibling-cut test, dispatch prompt shape, monitoring cadence, artifact-first merging, and sibling stop conditions. Triggers on 'steer these sessions', 'dispatch a worktree session', 'fan this out into Agent Manager', 'merge what the sessions returned'.
version: 0.1.0
author: Workflow Lab
created: 2026-08-29
updated: 2026-08-29
---

# Session Steering

## Use when
- The operator explicitly authorized Agent Manager sessions, worktrees, or model comparison for this work.
- The admitted work has disjoint ownership and useful independent context across a real long-lived arc.
- This session will still be here to accept the returns.

## Do not use when
- Authority is missing. Absence of this skill is not the gate; `tool-usage-discipline` is.
- A bounded internal `task` can close the unit in one return without losing needed context, or self-execution suffices for one command or measurement.
- The work is latency-sensitive operator ping-pong. Copilot mode is a correct topology, and dispatching would make it worse.
- Two units need the same file or the same semantic contract. Cut differently or keep it local.

## Behavior change
This skill turns the orchestrator's admitted session cut into registered dispatch, an executable child checklist, state-driven monitoring, evidence-first integration, and explicit cleanup. Norms live in [registered-session-lifecycle](../../rules/registered-session-lifecycle.md); this procedure does not grant session, recursion, write, commit, or push authority.

## Steering versus inline delegation

Apply the [orchestrator's selection table](../../agents/workflow-orchestrator.md#select-self-internal-task-or-agent-manager) first. Explicit session authorization and independent-context/long-lived usefulness are both required. Then record which context property the admitted sibling preserves:

| Reason | Test |
|---|---|
| context survival | the unit must outlive this session's next compaction |
| separate write surface | the unit needs its own worktree or branch, disjoint from mine |
| different authority | an independently scoped owner is needed; a different model is selected only if the user requested it |
| operator visibility | the operator wants to watch, resume, or take the unit over |
| genuine wall-clock gain | the units run long enough that dispatch and merge cost less than running them here |

"It feels parallel" is not on the list. Neither is size.

## Cutting a task a sibling can own

A sibling does not inherit this conversation. Cut for a cold start.

Six conditions, all required:

1. **One owner, one write set.** Its exact task writes are disjoint from mine and every sibling's, whether in isolated worktrees or an explicitly shared directory. Read-only ownership uses an empty write set. If two siblings would author one file or semantic contract, the cut is wrong.
2. **One acceptance result.** Name a checkable deliverable, not a topic. Use an inline CWOS return or an existing authorized artifact; read-only work creates no report file.
3. **Complete without me.** Pre-reads named as exact paths in reading order, boundaries named, non-goals named. If the sibling would have to ask me a question to start, it is not cut yet.
4. **Finishable without a mid-flight decision from me.** If a decision is unavoidable, the sibling records it as a blocker in its deliverable instead of waiting.
5. **Inspectable.** It returns source-bound evidence and exact paths or an inline result I can check. A state change I must trust is not a sibling result.
6. **Deletion test.** If this sibling is removed, name the decision, domain, or proof that becomes unavailable. No concrete answer means no sibling.

## Register before dispatch

Use the runtime's supported interface, not a hand-written registry edit. The frozen conceptual interface retains `wake_register` operations register/unregister/clear/show, with `on_behalf_of` restricted by the lifecycle rule. Exact public field names and call syntax belong to the implementation owner; no example here is a verified invocation.

1. Freeze the child task, write set, delivery requirement, intended role, authorized identity selection, recursion permission, expected return, monitoring policy, and stop condition in the existing shared board.
2. Prepare a session without an initial task prompt. Obtain its actual ID and canonical work directory from returned/listed session metadata. Do not invent an ID or use the display name as identity.
3. Register the actual parent/child edge and read it back before sending work. Include caller/effective-parent identity, exact write set, delivery requirement, role/runtime identity observation, and monitoring policy. Record unavailable identity as unknown, never as intended-equals-observed. If the runtime cannot bind identity safely before task execution, record a pre-flight blocker.
4. For a nested edge, confirm explicit recursive-subtree authority. An `on_behalf_of` effective parent must be the real caller's registered descendant with an existing edge permitting delegation. Refuse a foreign parent, cycle, ownership conflict, malformed registry, or reparent attempt.
5. Send the filled child prompt only after matching edge readback. At the first observed assistant turn and before continuation, compare current assistant metadata with the admitted agent/provider/model/variant and role. Missing evidence or mismatch blocks substantive work; do not substitute a verbal identity claim or config intent.

An empty-session preparation and a model override may not be composable in a given runtime. Do not solve that by sending work early. Require the implementation owner's supported route and evidence, or keep this route blocked.

## The dispatch prompt

A dispatch prompt carries these six task parts plus the full obligations block below. Fill it for every child, including every explicitly authorized nested child.

- **Anchor.** One or two sentences: what exists, why this task exists now, which artifact defines the scope.
- **Pre-read stack.** Exact paths in the order they should be read.
- **Work.** Numbered steps, each with a verb and an object.
- **Deliverable.** Exact acceptance result and inline return or authorized existing path; no per-lane report by default.
- **Boundaries.** What must not be touched. Name live doctrine surfaces, protected trees, other sessions, and anything outside the sibling's worktree.
- **Voice and register.** Which writing rule applies to the artifact.

This skill contains the dispatch checklist. Do not load another prompt skill unless a named wording capability is missing and its admission does not widen scope.

Two failure shapes to check before sending: a prompt that names a topic instead of a deliverable, and a prompt that assumes context this session holds and the sibling cannot see.

### Parameterized child prompt

```md
Anchor: {{request_anchor; accepted_contract; current_phase; target_end_state}}
Pre-reads in order: {{exact authorized paths, including lifecycle rule}}
Work: {{numbered steps; acceptance invariants; next authorized nodes}}
Deliverable: {{inline CWOS return or authorized artifact; proof; source identity}}
Boundaries: {{write allowlist; excluded paths; non-goals; approval boundaries}}
Voice: {{applicable writing rule and artifact register}}
Prior knowledge: {{decisions; discoveries; warnings; reusable/invalidated proof}}

[child_obligations]
- [ ] Bind parent {{real_parent_id}}, self {{real_child_id}}, canonical directory {{directory}}, task write set {{exact_paths_or_empty}}, role {{role}}, and delivery {{required/pending-authorization/not-required + reason}} to the read-back edge {{registration_evidence}}. Registration grants no authority.
- [ ] Check observed current assistant metadata {{identity_evidence_or_unknown}} against admitted agent/provider/model/variant {{identity_contract}} before substantive work and continuation. Block on unknown/mismatch; do not trust self-description or config intent. Stay in {{role}}, never silently become orchestrator.
- [ ] Recursion is {{forbidden_or_explicit_subtree}}. If permitted, repeat empty preparation -> real ID -> edge registration -> readback -> task prompt at every level and include this entire checklist. Use on_behalf_of only for the real caller's registered descendant whose existing edge permits delegation. Reject foreign parents, cycles, ownership conflicts, malformed state and reparenting.
- [ ] Own {{acceptance_result}} through verification, focused in-scope revisions and authorized delivery. Keep commands, measurements and mechanical retries here, not in courier/replacement lanes. Document compact CWOS status, actual skills, changed paths, D/F/W and fresh proof in {{inline_or_authorized_destination}}; read-only work writes no files.
- [ ] If delegating, retain responsibility for {{owned_descendants}} and reconcile every return against {{contract}}. Idle is not completion. On wake with authorized open work, prompt the existing owner or record {{concrete_blocker_and_owner}}; do not stop at a report or infer completion from clean Git.
- [ ] Preserve {{permissions/questions/pending_approval_card}}. Do not infer approval from a wake, answer unseen question options, bypass permission blockers, or continue {{paused_or_stopped_sessions}}. A missing delivery approval stays pending, with repeat continuation suppressed for that blocker.
- [ ] Monitor {{N_minutes_default_5_trial; deadline; state_trigger}}. Count a stall only while idle + task-owned dirty/untracked or ahead/unpushed + no active descendant hold continuously; reset on change, deduplicate, and keep unknown/offline/question/permission states unknown rather than clean/no-active.
- [ ] Return metadata-only observations {{timestamp; task/repo dirty_untracked_counts; HEAD; branch; remote_tracking; ahead_or_unknown; identity; evidence_pointer}}. No file contents or secrets in wakes. Preserve correlated delivery errors; reconcile ambiguous accepted prompts before retry.
- [ ] Track {{owned_process_ids_and_origin}}. Stop and verify only your own task processes before closure. Never stop a foreign runtime or infrastructure carrying this session; report an ownership blocker. Reconcile owned descendants before declaring your own delegated work complete.
- [ ] Finish in order: verify {{invariants}} -> compact document {{evidence}} -> commit only if {{commit_authority}} -> push only if {{push_authority}} and prove direct remote SHA equality {{remote_branch}} -> explicit deregistration/readback {{edge}}. Parent independently checks task state and delivery. Preserve required-but-unauthorized delivery and registration; apply only explicit read-only/local-only exceptions {{exceptions}}.
- [ ] On {{stop_condition}}, cancel future dispatch and task-owned pending wakes first, stop only positively identified owned children/processes, and retain unfinished/pending-delivery evidence. Already-queued prompts cannot be claimed unsent. Abort deregistration is explicit cleanup, not completion.
- [ ] Unattended work is {{not_admitted_or_exact_roundtrip_evidence}}. Require a fresh real parent/child chain roundtrip at every link, including a middle node that is both child and parent, before unattended use. Synthetic tests or installation alone do not pass.
```

The placeholders are prompt parameters, not a registry schema. Preserve the whole checklist when specializing a child-prompt template; fill non-applicable fields with an explicit reason rather than deleting the obligation.

## Monitoring without becoming a clock

At dispatch, record three things per sibling in the shared board: the expected return artifact, a duration class, and an outer deadline.

Then:

- Do other work between checks. A steering session that only polls has stopped producing.
- `list` is the poll. Apply the existing three-unchanged-polls law from `tool-usage-discipline`: after three unchanged reads, record one transition (`WAIT_UNTIL`, `CHANGE_MONITORING_STRATEGY`, `ESCALATE`, `ABORT_AT`) and do not poll again until its condition or a changed state occurs. Sibling intervals are minutes to tens of minutes, not seconds.
- Read the declared stall and wake policy from the registered edge. Apply the lifecycle rule's continuous N-minute predicate, unknown-state handling and deduplication; keep polling cadence distinct from the stall threshold.
- On a wake, reconcile the return, descendant state and authorized next nodes. Prompt the existing owner for open authorized work or record the blocker. Permission/question/approval/pause/stop states block only the affected action.
- `idle` is a candidate, not a result. Verify the deliverable and task state independently; a delegating lane remains accountable for its descendants.
- Never `stop` on ambiguity. Verify ID, title, model, and origin first; an ambiguous single-session listing is not stoppable.
- If a sibling is silent past its outer deadline, inspect blockers and identity first, then send one authorized prompt naming the next action or needed evidence. Reconcile ambiguous delivery instead of retrying blindly. Escalate a persistent blocker rather than dispatching a replacement.

## Merging what comes back

- **Evidence first.** Read the authorized artifact or inline return and check the claimed effects against source-bound proof. Treat summaries and session state as pointers, not acceptance.
- **One integration owner.** This session owns the merged result and its write surface. Siblings never write into it.
- **Chain-thinking per return.** Run the orchestrator's post-lane check: quality, purpose, insights, protocol, next move. A mechanically complete return that missed the purpose is not accepted.
- **Contradictions route to `synthesis`.** Two returns that disagree are a convergence problem, not a re-dispatch problem.
- **Keep raw output out.** Authorized scratch stays under the approved temp path, not in Git. Read-only work stays inline. Pull compact claims and evidence pointers into the board.
- **Carry D/F/W forward.** A sibling cannot see the board, so anything the next sibling needs goes into its dispatch prompt explicitly.

## Priority and stop conditions

Re-decide after every return. A steering run is not a fixed plan executed to completion.

For normal closure, independently check verified work, compact evidence, descendants/processes, and the contract's Git delivery. After authorized commit and push, compare the local commit to the exact remote branch SHA directly, not only a local tracking ref. Missing authorization retains pending delivery and registration. Explicit read-only/local-only exceptions skip only the excluded delivery steps. Deregister explicitly and read back cleanup before retiring the owned session.

For a deadline, withdrawn task, or unsafe continuation, use the lifecycle rule's stop/abort path. Cancel future dispatch and pending wakes before stopping identified owned children/processes. Record unfinished work and any already-queued prompt that cannot be recalled. Do not call cancellation completion.

Stop the steering run when:
- every dispatched sibling has been merged or explicitly abandoned,
- or steering output has started to exceed product output without a recovery, compliance, or irreversibility reason.

Count sibling dispatches separately on the existing execution-budget ledger and compare launches with useful independent owners. Apply CWOS tripwires; this skill adds no numeric cap. Any sibling beyond the declared cut set needs a marginal-value record naming what no existing owner can prove. A silent or disappointing return does not authorize a replacement launch.

## Anti-patterns
- **human clock** - polling a sibling on a wall-clock rhythm instead of a declared condition
- **fan-out theater** - dispatching to look parallel when the units share a write surface
- **courier session** - a steering session that routes and never produces an artifact of its own
- **orphan sibling** - a dispatched session with no named deliverable, no deadline, and no merge plan
- **summary trust** - accepting a status line as proof that a deliverable exists
- **hand-carried bus** - relaying content between sessions by paste when a file would cross the same boundary
- **replacement dispatch** - answering a silent sibling by starting another one

## Guardrails
- Authority comes from the operator's explicit Agent Manager request, never from this skill and never from orchestration language.
- Do not stop a session this run did not start.
- No nested steering. A sibling may not steer further siblings unless the operator authorized that subtree explicitly.
- Cross-workspace steering stays manual today. Do not simulate it by pasting protected content across boundaries.
- A sibling working in a child repo obeys that repo's boundaries, not this shell's.

## Completion checklist
- [ ] Authority named
- [ ] Sibling-cut test passed per unit
- [ ] Dispatch prompt carries all six parts
- [ ] Every child prompt carries the filled full obligations block
- [ ] Real edge registration/readback preceded each task prompt
- [ ] Runtime identity is observed, not self-reported; mismatches blocked
- [ ] Monitoring contract recorded per sibling
- [ ] Deliverables read, not assumed
- [ ] Merge owner named and contradictions routed
- [ ] Stop condition recorded per sibling and for the run
- [ ] Required delivery and explicit deregistration are proven or remain visibly pending
- [ ] Real per-link chain proof exists before any unattended admission

## Deliberate template omissions

The package carries the reusable procedure and checklist. Root operator observations, private preferences, child-repo identities, source paths and benchmark records are omitted under the root-to-template derivation contract. Target runtime API syntax and live proof must be supplied locally; copied doctrine does not activate registered wakes.
