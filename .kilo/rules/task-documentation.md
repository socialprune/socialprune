# Task Documentation Rule

> **MANDATORY FOR NON-TRIVIAL ORCHESTRATED `.kilo` WORK**
> Keep temporary evidence outside Git and durable task evidence compact.
> **Version:** 1.4.0
> **Updated:** 2026-07-25

---

## Constitutional Minimum

When the contract authorizes filesystem output, task evidence must stay recoverable without turning the repository into a raw-output or per-round narrative warehouse. Read-only authority overrides artifact defaults.

---

## Hard Laws

1. The newest user request and Active Execution Contract determine write authority. A skill, agent, mode, template, task procedure, tool capability, frontmatter permission, or artifact default never creates it.
2. If the task is read-only, inspection-only, explanation-only, planning-only without authorized writes, or has no authorized write domain, render plans, contracts, handoffs, protocols, explanations, and evidence inline. Do not create `.kilo/plans/`, `docs/tasks/`, checkpoints, reports, evidence files, temporary task files, task directories, or any other filesystem artifact, and do not request write permission merely to satisfy a template.
3. "Write" or "render the template explicitly" means visible structured output, not file creation, unless filesystem output is already authorized.
4. Temporary storage is not a loophole. Read-only work may not create `%LOCALAPPDATA%\Temp\kilo` task files unless the user or an accepted runtime operation explicitly authorizes temporary output.
5. When filesystem output is authorized, put scratch, raw output, staging copies, and intermediate evidence under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\`, not in Git. Temp can be swept at any time, so anything that costs model runs or hours to regenerate also gets a durable copy outside temp in the same flow that creates it.
5a. Temp scratch is reachable by the built-in read, write, and shell tools and is **not** reachable by `semantic_search` or the MCP filesystem tools, which are bounded to the workspace. Retrieve temp scratch by exact path. Do not search it, and do not treat the resulting `path must be within the current workspace` refusal as a fault to work around.
6. Durable task evidence is legal only when the user explicitly requests or authorizes it, the accepted end state requires repository delivery, or it has named lasting recovery, compliance, forensic, irreversible-operation, or explicit cross-session handoff value. Keep it to at most one compact execution/decision artifact, one validation artifact, and one closure artifact when the applicable closure contract requires it.
7. Do not create per-lane reports, per-round narratives, duplicate manifests, or committed raw-output warehouses.
8. Before commit, classify every changed or untracked path as product/source, durable test, migration, operational documentation, compact task evidence, generated/staging, or unrelated pre-existing work.
9. Stage exact task-owned paths only. Generated/staging and unrelated paths remain unstaged; task-owned residue must receive an explicit terminal action rather than being ignored.
10. Default execution truth to one inline/shared board containing source identity, active owner, open invariant classes, reusable proof, invalidated proof, next ready node, and execution-budget state.
11. Without artifact authority, stay inline or fail closed as `needs_context` / `blocked`; do not take a permission-seeking artifact detour.

---

## Normal Shape When Filesystem Output Is Authorized

```text
%LOCALAPPDATA%\Temp\kilo\<task-slug>\
└── scratch, raw, staging, intermediate evidence

optional durable package
├── one execution or decision artifact
├── one validation artifact
└── one closure artifact when required
```

Most runs need no new durable task directory. Existing task-local paths may be used only when the contract authorizes filesystem output and the evidence has lasting value. Otherwise the complete task structure remains inline.

---

## Failure Rule

Task documentation fails when read-only work creates any task artifact or temporary task file, when artifact defaults are treated as write authority, when temporary evidence enters Git by default, when durable evidence becomes a per-lane warehouse, or when staging includes paths without an explicit value class and task ownership.

---

*This rule improves recoverability and auditability without reviving warehouse-style task bureaucracy.*
