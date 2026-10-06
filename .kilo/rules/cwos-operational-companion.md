# CWOS Operational Companion

> **MANDATORY FOR NON-TRIVIAL DELEGATED `.kilo` WORK**
> Compact operational standard for delegated-lane artifacts, status honesty, and bounded convergence.
> **Version:** 1.7.1
> **Updated:** 2026-07-25

---

## Purpose

This companion operationalizes `cwos-core.md` without turning CWOS into a warehouse rule.

Use it to keep delegated work reconstructable, bounded, and pass-forward safe.

For registered sessions, [registered-session-lifecycle](registered-session-lifecycle.md) owns parent/child obligations, wake action, continuous idle/Git stall detection, and deregistration. CWOS status and qualitative revision-stall judgment remain here; an idle session is not a `done` lane.

---

## Delegated-Lane Status Vocabulary

Use this internal delegated-lane vocabulary for non-trivial work:

| Status | Meaning |
|---|---|
| `done` | The delegated lane satisfied its contract with verification evidence. |
| `done_with_concerns` | The lane finished every required in-scope behavior and proof; only external, non-blocking caveats remain visible. |
| `needs_context` | The lane cannot proceed honestly without missing authority, input, or boundary clarification. |
| `blocked` | The lane is stopped by a real blocker that is not solved inside the lane. |
| `needs_review` | The lane produced a candidate result that requires explicit review before acceptance. |

### Normalization boundary

- CWOS lanes may use the full internal vocabulary above.
- When target-specific closure applies, terminal closure must normalize to `done`, `blocked`, or `needs_review` per the locally activated closure companion.

### Compact gate vocabulary

Use this gate language consistently when a lane or convergence step hits a control point:

| Gate | Meaning | Default response |
|---|---|---|
| `pre-flight` | entry condition is not satisfied yet | stop before work widens; fix the missing precondition first |
| `revision` | output exists but is not yet good enough | send targeted findings back to the producing lane |
| `escalation` | local revision is no longer reducing the real uncertainty or issue load | surface the decision upward instead of looping again |
| `abort` | continuing would create damage, false progress, or meaningless output | stop immediately and preserve state |

This is shared vocabulary, not a new warehouse procedure. Use it to keep orchestrator, CWOS, synthesis, and gate skills talking about the same control states.

---

## Active Execution Contract And Shared Evidence Board

The accountable parent freezes one authority packet before implementation and maintains one shared execution/evidence artifact. It must contain:

- `request_anchor`, `accepted_plan`, `target_end_state`, `authorized_phases`, `current_phase`,
- `approval_boundaries`, `authorized_write_domains`, `non_goals`, `acceptance_invariants`, and `plan_invalidation_conditions`,
- dependency DAG, critical path, `foundation_gates`, `parallel_ready_nodes`, `next_ready_nodes`, integration order, and long-lived `domain_owners`,
- decisions, discoveries, warnings, and current lane status,
- evidence records with command/readback, source identity, result, and freshness,
- findings grouped by invariant or risk class,
- stop-loss decisions for extra lanes, tests, revisions, or artifacts,
- source identity, active long-lived owner, open invariant classes, reusable proof, invalidated proof, next ready node, and execution-budget state,
- pending approval cards with internal ID, version/hash, item IDs, expiry, evidence, thread binding, visible material terms, and declared effect (`confirm-only`, `confirm-and-queue`, or `immediate-execute`).

Use one active write owner per writable surface. Parallel lanes may append structured returns through the parent, but may not concurrently author the same file or semantic contract.

Before every extra subagent, reviewer, test-writer, broad rerun, or revision, the parent records: remaining acceptance classes; missing or invalidated evidence; why the long-lived owner cannot close it; unique evidence the extra work will produce; and coordination cost. If no new risk class or independent-authority requirement exists, the extra work is prohibited and stays with the owner.

Before every additional procedural skill, record the missing primary capability, concrete upcoming action, exact behavior change, and confirmation that topology and authority do not enlarge. Default to one primary procedural skill per phase.

Execution-budget state tracks delegated launches, independent reviews, broad suites per repo, routine revisions, unchanged process polls, and product/test delta versus workflow/evidence delta. Every tracked process declares readiness, expected completion, an outer timeout, or long-running-service status. After three unchanged polls, record exactly one canonical transition from the tool rule and block another unchanged poll until the declared condition, changed state, or monitoring transition occurs. Crossing 5 launches, 2 reviews, or 1 broad suite per repo without invalidation triggers a topology reset and marginal-value decision. Apply the same reset when process residue materially exceeds implementation/test value without recovery/compliance/irreversibility need, or an already-authorized node requires a manual user release.

At every phase boundary, compare next nodes to the contract. `done` releases authorized dependents whose foundation gates passed; it never expands the plan. Only a real scope delta requires user approval.

Evidence freshness uses these states:

| State | Meaning |
|---|---|
| `fresh` | directly observed against the current integrated source identity |
| `reused-valid` | unchanged evidence whose dependencies remain intact |
| `invalidated` | source, schema, generated output, fixtures, runtime identity, or merge resolution changed |
| `independent-sample` | fresh reviewer observation used for acceptance rather than producer self-certification |

Do not create per-lane narrative reports. Scratch, raw output, staging, and intermediate evidence stay under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\`; the shared board keeps only compact claims and evidence pointers.

### Cross-process foundation gate

The first executable cross-process command gate must prove one foundation before a large scenario matrix, broad review, downstream wave, or deep test-modernization work:

1. a disposable datastore or equivalent shared state is reachable,
2. the real API/build entrypoint compiles and starts,
3. each worker/service starts and stops under the tracked background-process lifecycle,
4. fakes, fault injection, and test mutations are unreachable from production entrypoints and normal runtime environments,
5. one minimal real lifecycle path crosses the domain's confirmation, ownership claim, start, test request, and settlement states with asserted changes.

Keep downstream matrix, review, and deep test-modernization nodes inactive until this gate passes.

### Approval continuity

Use a channel-neutral, mobile-first card. The user sees exact recipients, text, material values, exclusions, selected items, and the effect of approval; the system keeps machine identity internal. Natural replies such as `yes`, `looks good`, or `do it` are examples, not required phrases. A natural reply resolves only the one fresh pending card most recently and immediately presented in the same conversation/thread. If any visible term or declared effect changes, explicitly mark the old card superseded and no longer pending, then present a new versioned card. Confirmation aimed at the superseded card fails; confirmation of the immediately presented replacement stores reply plus card reference. Zero, multiple, expired, stale-thread, ambiguous, or free-floating approval fails closed. Preserve pending approval through handoff or compaction and block only the affected action.

---

## Compact Artifact Package

For non-trivial delegated work, maintain a compact artifact package:

1. **task** — scope, owner, acceptance, and non-goals
2. **status** — current lane state using the delegated-lane vocabulary
3. **handoff** — what the next lane must know
4. **convergence** — required only when multiple lanes or rounds must be synthesized

These normally live in the shared execution/evidence artifact. The package must stay compact and auditable.

For one bounded implementation lane plus one compact independent gate, use one inline or existing artifact. Store a compact durable task artifact in Git only when lasting recovery, compliance, forensic, or operator value justifies repository storage. Do not create convergence packaging when no convergence is occurring.

---

## Minimum Per-Lane Fields

Each non-trivial delegated lane must leave enough structured truth to show:

- objective,
- governing authority,
- status,
- skills loaded,
- decisions,
- discoveries,
- warnings,
- verification evidence,
- next-lane handoff or explicit close-out.

Use short D/F/W-style knowledge transfer when possible:
- **Decision** — a choice that later lanes should not silently undo
- **Discovery** — a finding that changes later execution
- **Warning** — a pitfall, blocker, or anti-pattern the next lane must respect

### Compact protocol template

```md
[protocol]
  request_anchor:
  accepted_plan:
  current_phase:
  authorized_write_domain:
  objective:
  governing_authority:
  lane_status:
  skills_loaded:
  skills_expected:
  skills_gap:
  decisions:
  discoveries:
  warnings:
  verification_evidence:
  next_ready_nodes:
  handoff_or_closeout:
```

Use this exact compact skeleton unless the task artifact already preserves the same fields clearly.

---

## Skill-Reload Tracking

Each non-trivial lane must record which skills were loaded during execution.

This enables retrospective analysis: comparing intended skill usage against actual skill usage to find enforcement gaps and optimization opportunities.

### Required fields

In the CWOS execution artifact, include:

| Field | Content |
|---|---|
| `skills_loaded` | List of skills actually loaded/invoked during the lane, backed by tool output, local/global path, or explicit invocation evidence |
| `skills_expected` | Skills admitted for the phase: the primary skill plus additional skills that passed the four-part admission gate |
| `skills_gap` | An admitted skill that could not be loaded, or a required phase capability that remains uncovered; matching catalog entries alone are not gaps |

Do not list a skill under `skills_loaded` or `skills_expected` because it was named, loosely matched, or appeared in a pairing hint. `skills_expected` is an admission record.

---

## Checkpoint And Recovery

### Save a filesystem checkpoint only when
- real cross-session recovery is likely,
- an irreversible or expensive operation needs restart evidence,
- compliance or forensic value requires durability,
- or an explicit durable handoff cannot stay inline.

A checkpoint should preserve:
- current objective,
- files read or changed,
- current findings,
- next intended step,
- and any unresolved blockers.

Handoffs must also preserve working paths, governing authority, and failed attempts. Reuse this evidence instead of forcing later lanes to rediscover it.

### If context condenses or continuity is lost
- re-read the governing authority,
- re-read the latest checkpoint if one exists,
- restore the D/F/W knowledge before continuing,
- and do not ask the user to restate the request if the task artifact already preserves it.

---

## Topology Vocabulary

Use explicit topology names instead of vague orchestration language:

| Topology | When to Use |
|---|---|
| `single-lane` | One role can complete the work cleanly. |
| `baton-pass` | Later work depends on an earlier lane's result. |
| `bounded-wave` | Independent DAG nodes have disjoint write sets, distinct acceptance results, and known integration order. |
| `independent-gate` | One independent acceptance pass may return one targeted revision before a decision gate. |

`bounded-wave` is legal only when one lane's output is not needed before another can begin honestly, write sets are disjoint, acceptance results are distinct, discovery/test/review perspectives are not duplicated, and integration order is known before dispatch. Otherwise use one foundation/integration owner or a baton pass.

Use the maximum safe concurrency inside that boundary. A long-lived domain owner keeps discovery, implementation, focused proof, and in-plan bug loopbacks. Do not create commit-only, status-only, retry-only, per-callsite, duplicate-reviewer, or narration-only micro-lanes.

That owner also keeps every callsite of the invariant class, fixtures, clocks, paths, stale signatures, scenario isolation, focused test repairs, mechanical retries, and one bundled revision. A new lane requires a new domain, independent authority, or genuinely new acceptance-risk class. The owner may not return `done` or `done_with_concerns` with failing required tests, missing required proof, incomplete required harness behavior, or fixable same-scope failures.

---

## Anti-Nested-Recursion Law

A delegated lane may not spawn further lanes unless recursive subtree behavior was explicitly authorized by the parent topology.

If recursive delegation is not pre-authorized, the lane must return `needs_context` or `blocked` rather than expanding its own tree.

---

## Anti-Chaos Guardrails

- Do not launch overlapping lanes with the same perspective.
- Do not treat “parallel” as permission for duplicated authorship.
- Do not give two active lanes the same writable surface or semantic contract.
- Do not claim convergence without a named convergence artifact or equivalent synthesis section.
- Do not let handoff truth depend on narrative memory alone.
- Do not keep a lane in `revision` just because another round feels cheap. If the new round is not reducing the actual problem, the next honest gate is `escalation`, not another quiet retry.
- `done_with_concerns` may carry only external non-blocking caveats. Failing required tests, missing proof, incomplete harness behavior, and fixable same-scope failures are `revision` or `blocked`.
- Do not create another review lane solely because a lane returned `done_with_concerns`; continue or converge while surfacing the external caveat.
- A mechanical quoting or invocation failure may be corrected once by the same owner without invalidating unrelated valid evidence.
- Findings must name `invariant_class` and consolidate all known in-scope callsites. Another callsite does not justify another lane.
- Long commands, services, watchers, and acceptance runs use the tracked background-process tool. Read status and logs separately. A lane must not stop a foreign or out-of-scope runtime; it reports the blocker to the parent.
- Agent Manager visible sessions, worktrees, and model comparisons require an explicit user request for that exact behavior. Generic orchestration language is not authority.

---

## Revision And Stall Discipline

Use bounded revision language without turning CWOS into a loop engine:

- One routine targeted revision goes back to the owner of the failed invariant. `revision` is valid when it has a concrete, narrower feedback packet and a real reason to believe the output can improve.
- `escalation` is required when the remaining concerns stay materially the same across rounds, the ambiguity is no longer shrinking, or the producing lane cannot answer the governing purpose honestly.
- `abort` is required when continuing would create false completion, destructive confusion, or output that cannot be trusted downstream.

After the routine revision, use a decision gate. A second quiet loop is forbidden. Extra work requires a genuinely new acceptance-class risk, not another callsite of a known invariant. Budget expiry never permits an unresolved acceptance defect to pass.

Normal Complexity-4 budget is: at most one architecture review for a genuine open architecture question or explicit adversarial independent review; one implementation wave; one broad suite per affected repo per final executable freeze identity; one multiprocess acceptance run when in scope; one independent acceptance gate; and at most one bundled class-based revision before the decision gate.

Stall detection stays qualitative here on purpose. The rule is simple: if the latest round is not reducing the real blocker set, the loop is stalled.

### Outcome interpretation for convergence-sensitive work

Use these shortcuts when lane status must feed a convergence decision:

| Status or state | Read it as | Next step |
|---|---|---|
| `done` | contract satisfied with proof | continue or converge |
| `done_with_concerns` | every required in-scope behavior and proof passed; only an external, non-blocking caveat remains | continue or converge while surfacing the caveat; do not open a review lane solely for this status |
| `needs_review` | candidate output exists but still needs explicit judgment | run the named reviewer or gate |
| repeated `revision` with no real improvement | stalled loop | escalate or reroute |
| unsafe continuation | invalid path | abort |

---

## Review Sequencing Hook

When review is part of the topology, default order is:

1. contract/spec compliance first,
2. implementation quality second,
3. rerun or revise if either fails,
4. escalate or reroute if repeated revision is no longer reducing the gap.

The reviewer role remains the independent owner of that judgment.

Evidence may be deduplicated across the sequence. One fail-closed structured check may prove several related claims, and unchanged claims need not be repeated in each lane unless the acceptance contract requires independent fresh observation.

Out-of-plan findings are recorded and routed without opening a lane. In-plan findings stay with the long-lived domain owner when needed for an existing acceptance invariant.

---

## Failure Rule

CWOS operational compliance fails when delegated work has no honest status, no compact artifact package, no pass-forward knowledge, or no bounded convergence story.

---

*This companion adds execution clarity while keeping CWOS itself thin and constitutional.*
