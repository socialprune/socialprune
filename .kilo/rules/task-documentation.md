# Task Documentation Rule

> **MANDATORY FOR NON-TRIVIAL ORCHESTRATED `.kilo` WORK**
> Keep temporary evidence outside Git and durable task evidence compact.
> **Version:** 1.5.0
> **Updated:** 2026-10-20

---

## Constitutional Minimum

When the contract authorizes filesystem output, task evidence must stay recoverable without turning the repository into a raw-output or per-round narrative warehouse. Read-only authority overrides artifact defaults.

---

## Hard Laws

3. "Write" or "render the template explicitly" means visible structured output, not file creation, unless filesystem output is already authorized.
5. When filesystem output is authorized, put scratch, raw output, staging copies, and intermediate evidence under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\`, not in Git. Temp can be swept at any time, so anything that costs model runs or hours to regenerate also gets a durable copy outside temp in the same flow that creates it.

Numbers missing from this section belong to laws the Workflow Lab removed after measurement on Opus 5.5 and GPT-6.1 Sol, and they stay retired. `.kilo/RETIRED_DOCTRINE.md` keeps each one with its wording and evidence.

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
