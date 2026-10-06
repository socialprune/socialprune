# Knowledge Accumulation Rule

> **MANDATORY FOR MULTI-LANE `.kilo` WORK**
> Important knowledge from one lane must be passed forward explicitly.
> **Version:** 1.3.0
> **Updated:** 2026-07-18

---

## Constitutional Minimum

Multi-lane work requires one frozen authority packet and shared evidence board so later lanes can reuse settled decisions, discoveries, warnings, and proof without replaying discovery.

---

## Hard Laws

1. In multi-lane or multi-round work, the next lane must receive the important knowledge from earlier lanes.
2. The minimum pass-forward set is:
   - decisions,
   - discoveries,
   - warnings.
3. The next lane may receive this as a compact `prior_knowledge` block, a task artifact section, or a clearly equivalent handoff.
4. Every non-trivial lane should contribute new knowledge back into the pass-forward set when it learns something material.
5. Single-lane trivial work is exempt.
6. Reuse unchanged evidence. Invalidate it when its source, schema, generated output, fixtures, runtime identity, or merge resolution changes.
7. Fresh context is selective, not universal. Reserve it where independent reconstruction adds value, especially final acceptance and security, recovery, or transaction review.
8. Pass forward the active contract, current phase, domain ownership, foundation-gate state, next ready nodes, and reusable proof when later work depends on them.

---

## Compact Pattern

Use a compact structure such as:

```md
prior_knowledge:
- active_contract:
- domain_ownership:
- reusable_proof:
- decisions:
- discoveries:
- warnings:

knowledge_contributed:
- decisions:
- discoveries:
- warnings:
```

This should live in the shared execution/evidence artifact rather than per-lane narrative files.

### Concrete D/F/W example

```md
prior_knowledge:
- decisions: D1: Keep this task limited to the target repo's active `.kilo` shell; do not widen into package refresh work in the same wave.
- discoveries: F1: The current rule already covers the core law, but lacks a compact repo-local example.
- warnings: W1: Historical or imported wording can be useful for substance mining, but live wording must stay local and shorter.

knowledge_contributed:
- decisions: D2: Added one compact example block instead of restoring the full imported procedure.
- discoveries: F2: The live artifact needed operational detail, not a larger structural rewrite.
- warnings: W2: If the next lane copies imported sections wholesale, style drift will reappear.
```

---

## Failure Rule

If a later lane repeats, contradicts, or ignores important earlier findings because no explicit pass-forward knowledge was preserved, knowledge accumulation has failed.

---

*This rule keeps fresh-context work from losing its own discoveries.*
