# Registered Session Lifecycle Rule

> **MANDATORY FOR PARENTS AND CHILDREN IN REGISTERED SESSION WORK**
> Registration preserves accountability. It grants no execution authority.

## Scope and authority

This rule owns the normative lifecycle for explicitly authorized Agent Manager work. The orchestrator owns self/internal-task/session selection and topology. [Session Steering](../skills/session-steering/SKILL.md) owns the procedure and parameterized child-prompt checklist. CWOS continues to own the compact protocol and evidence vocabulary.

## Hard laws

2. At every level, prepare an empty session -> obtain its real ID -> register its parent edge -> read back the edge -> send its task prompt. No task may run before registration is confirmed. If the runtime cannot support that order, block that route rather than dispatch unregistered work.
3. Registration and recursion authority are separate. A child may delegate only inside its explicitly authorized recursive subtree. `on_behalf_of` may name only a registered descendant of the real caller whose existing parent edge explicitly permits delegation. Record both actual caller and effective parent. Reject foreign parents, cycles, malformed registries, conflicting ownership, and silent reparenting.
4. Each edge binds session identity, canonical work directory, exact task write set, delivery requirement, intended role and observed runtime identity, recursion permission, and monitoring policy. These are conceptual requirements, not a claim about public field spelling or an executable API call.
5. Read runtime identity from current observed assistant metadata, including agent/role, provider, model, and variant. A session's verbal self-description, card title, or configured intent is not runtime proof. Missing identity or a role/model mismatch blocks task execution or continuation until reconciled with authority. Match exact parsed identities, not prefixes or substrings.
9. A stall requires continuous idle AND task-owned dirty/untracked or ahead/unpushed work AND no active descendant for N minutes. Initial N is five minutes, configurable as a trial setting. Reset on state change and deduplicate alerts. Unknown, offline, permission, or question state never proves clean Git or absence of active descendants; unknown interrupts a qualifying interval rather than counting toward it.
10. Wakes and completion notifications carry metadata only: observation time, dirty/untracked counts with task/repo scope distinguished, HEAD/branch, remote tracking and ahead knowledge, identity and outcome/evidence pointers. Never include file contents or secrets. Unknown values remain unknown; clean Git is not task-completion proof.
11. Wake transport preserves observed agent/provider/model/variant identity and a correlated delivery-failure record. Ambiguous prompt acceptance requires reconciliation, never a blind retry. A successful enqueue is not proof the next owner acted.
14. Stop first cancels future dispatch and task-owned pending wakes, then stops only positively identified owned children/processes and records unfinished work. Cancellation cannot imply unsending already-queued prompts. Explicit abort cleanup may deregister canceled edges only with retained unfinished/pending-delivery evidence, never as a completion claim.
15. Before unattended admission, prove a fresh real chain roundtrip at every parent/child link, including a middle session that is both child and parent. Prove registration readback, observed runtime identity, return/wake delivery, parent action and cleanup. Synthetic event tests, one-hop success, file installation, or clean Git do not establish that chain.

Numbers missing from this section belong to laws the Workflow Lab removed after measurement on Opus 5.5 and GPT-6.1 Sol, and they stay retired. `.kilo/RETIRED_DOCTRINE.md` keeps each one with its wording and evidence.

## Required behaviors

- The parent fills the child checklist, retains one shared evidence board, and reuses the same domain owner for focused revisions. Do not create command-only, commit-only, push-only, status-only, or replacement lanes.
- The child returns compact CWOS status, actual skills, changed paths, D/F/W, source-bound proof, owned-process state, descendant disposition, and delivery state. Read-only work documents inline; this rule never creates file-write authority.
- Implementation, validation, Git delivery, registry cleanup, and unattended runtime proof remain separate claims. An API or transport gap blocks only the affected route; it does not authorize an invented invocation.

## Failure rule

Unregistered dispatch, unauthorized recursion, identity drift, report-only wakes over open authorized work, forgotten descendants/processes, premature deregistration, unknown-as-clean observations, or a stop that silently leaves future dispatch enabled violates this lifecycle. Keep unresolved work visible rather than labeling it complete.
