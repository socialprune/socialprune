# Wiring Verification Rule

> **MANDATORY WHEN CONNECTIVITY OR RUNTIME PATHS CHANGE**
> Correct files are insufficient when the system path is unwired.
> **Version:** 1.4.0
> **Updated:** 2026-07-16

---

## Constitutional Minimum

`.kilo` preserves the rule that "correct but unwired" is still failure.

---

## Hard Laws

1. Correct files are insufficient if the system path is unwired.
2. When a change affects runtime or workflow connectivity, wiring must be checked explicitly.
3. Dead or disconnected workflow components count as failure.
4. Wiring verification is part of the quality stack, not an optional polish step.
5. Detailed wiring checklists and category-specific examples belong outside the constitutional core.

---

## Required Behaviors

### When connectivity changes
- identify the affected connection path,
- verify the component is actually reachable or referenced as required,
- and treat disconnected success-in-isolation as insufficient.

For a bounded provider/model/transport change, prefer the shortest direct canary that proves the changed connection without persisting state or invoking unrelated integration layers. Do not route through agent/session/delivery/memory/state paths unless those consumers are themselves in scope.

Keep target-specific credential locations, transport flags, and request mechanics in target-local doctrine. Universal wiring law defines the proof boundary, not one provider's implementation.

### Compact verification taxonomy

Use the lightest verification type that honestly proves the connection:

| Type | Use when | Minimum proof |
|---|---|---|
| **reference wiring** | a file now points to another live file | the reference exists and resolves to a real target |
| **registration wiring** | a component must be discoverable by runtime or workflow loading | the component appears in the live registration or lookup path |
| **propagation wiring** | root standards are supposed to reach template or child-repo surfaces | the downstream surface shows the expected adopted artifact or documented gap |
| **consumption wiring** | a rule, skill, or pattern must actually be used by another surface | at least one real consumer references or invokes it |

If the change spans more than one type, verify each affected type instead of treating one pass as enough.

### Mechanical proof examples by type

| Type | Example proof shape |
|---|---|
| **reference wiring** | readback shows the reference, and the referenced path resolves to a real target |
| **registration wiring** | readback or lookup path shows the component in the live registry/discovery surface |
| **propagation wiring** | downstream template or child-repo artifact shows the expected adopted change, or the gap is explicitly documented |
| **consumption wiring** | at least one real consumer file references or invokes the rule, skill, or pattern |

These examples are intentionally thin. Use the lightest proof that honestly shows the connection is real.

### Synchronization note for derived doctrine

If a template doctrine change is supposed to propagate into target-repo copies or another derived surface, wiring verification is not complete until one of these is true:
- the downstream sync happened and was verified,
- or the current lane explicitly records that sync as later work outside the active scope.

Do not imply propagation happened just because the source template file was updated.

### Companion note

For step-by-step implementation use the matching reminder in `.kilo/skills/feature-implementation/SKILL.md`.

## Anti-Rationalization Guard

Do not bypass wiring checks with reasoning such as:

- "the file exists so it is wired"
- "the path is obvious"
- "someone else will connect it later"

If connectivity matters, proof of reachability beats assumption.

### When connectivity does not change
- wiring verification may be explicitly skipped with a real reason.

---

## Failure Rule

If the artifact is locally correct but disconnected from its intended runtime or workflow path, implementation is not complete.

---

*This rule preserves wiring verification as a constitutional differentiator of `.kilo`.*
