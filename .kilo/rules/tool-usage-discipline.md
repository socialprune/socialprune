# Tool Usage Discipline Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Shell and command tools are not general file-CRUD tools; controlled copy is allowed when verified.
> **Version:** 1.8.0
> **Updated:** 2026-09-08

---

## Constitutional Minimum

File truth must be protected by using the right tool for the right job.

---

## Hard Laws

1. Shell or command tools must not create, modify, delete, or move files as a general editing path.
2. Dedicated file tools remain the default path for file CRUD.
3. Controlled shell copy is allowed when no dedicated copy primitive is available and the operation is copy-only, bounded, and verified.
4. File-truth discipline is a quality law, not just a convenience preference.
5. Verification commands, inspection commands, package commands, and version-control commands are allowed when they do not mutate files except through the tool's intended domain behavior.
6. Thin constitutional guidance stays here; long operational examples belong outside the constitutional core.
7. Long commands, development services, watchers, and acceptance runs use the tracked background-process tool when available. Inspect lifecycle status and logs with separate calls; if the adopted repo lacks that tool, use the bounded parent-owned fallback below.
8. A lane may stop only runtimes it owns inside the current scope. Foreign or out-of-scope runtimes are blockers to report, not processes to kill. A mechanical invocation retry stays with the current owner. Before stopping a managed session, verify that its ID, title, model, and origin identify the intended child rather than the current parent; an ambiguous single-session listing is not stoppable.
9. Agent Manager visible sessions, worktrees, and model comparisons may be started only when the user explicitly requests those exact things. Generic requests to orchestrate, parallelize, or reach 100/100 do not authorize Agent Manager.
10. A whole-file write on a path that already has content is a replace operation, not an edit. Use an anchored edit on existing files, never send a placeholder body, and give an untracked shared execution/evidence board a scratch copy under the task temp path before its first append in a multi-lane run.
11. GitHub mutations and readback must be non-interactive and pager-free. A successful mutation command, URL, or exit code is not effect proof when the accepted claim depends on the hosted object; read the object back with `gh` and compare it to the frozen expected identity.

---

## Allowed vs Forbidden

| Category | Allowed | Forbidden |
|---|---|---|
| Shell / command tools | bounded build, test, lint, git, package management, read-only inspection, controlled copy with verification | file creation by content emission, file modification, file deletion, file move, unverified copy, blocking long-lived runners |
| Background-process tool | long commands, services, watchers, tracked acceptance runs; separate status/log inspection | stopping foreign or out-of-scope runtimes |
| File tools | create, update, move, delete, readback, copy when a dedicated copy primitive exists | n/a |
| Human/operator shell | manual file operations the operator explicitly chooses to run outside the agent tool session, and any step needing privileges the agent's environment cannot obtain | n/a |

When a required step needs elevation or another privilege the agent cannot acquire, hand it to the operator as an explicit, exactly specified manual step. Do not emit instructions that silently assume the agent process can elevate itself.

### Commands that can surface protected content

Review a command's possible output shape before running it, not after. A broad search or dump can surface protected content on its own, and filtering after the material has been emitted is too late.

- Prefer targeted patterns, metadata-only checks, and field projections over broad reads when the target may hold protected content.
- Exercise a protected-content control against synthetic fixtures first; run only metadata-level checks against the real protected surface.
- If protected material is exposed by accident, stop that path, do not repeat the material in later output, and replace it with a bounded projection of the fields actually needed.

### Command return reliability

Before execution, classify every command on two axes: **interactive or non-interactive**, and **return-critical or ordinary**.

- Automated commands default to closed, non-interactive stdin. Disable pagers, prompts, optional locks, and confirmation input unless that behavior is part of the claim being tested.
- GitHub CLI automation must disable pagers/prompts and request explicit machine-readable fields where practical. After `gh` mutations such as PR creation or metadata changes, perform a separate hosted-object readback before claiming the effect.
- A command that genuinely requires a TTY is not an ordinary synchronous shell gate. Use an authorized interactive path instead of hoping a blocked prompt will return.
- Return-critical commands use a parent-owned tracked background process even when they are expected to finish quickly. This includes terminal Git hygiene, broad tests, builds, migrations, acceptance gates, and the first command after a synchronous child handoff.
- Process completion and Kilo turn completion are separate. A command is fully returned only after the terminal process has ended **and** the next Kilo loop has resumed or the turn has closed cleanly.
- If synchronous execution is unavoidable, a newline sentinel, captured exit code, output flush, and explicit process exit may be used as a bounded fallback or diagnostic. The sentinel proves shell completion only; it does not prove that Kilo resumed.
- Never send synthetic Enter or newline input unless a live process is proven to be waiting at a known, authorized stdin prompt.

Return recovery is time-bounded:

1. At about 30 seconds without a full return, inspect the process, locks, retained output, any sentinel, and the Kilo runtime state.
2. By about 60 seconds, classify the condition as **process-stall**, **return-stall**, or **stale-ui** instead of waiting indefinitely.
3. If retained evidence proves the command completed, recover that result rather than rerunning the command.
4. Preserve parent, child, process, and session ownership during recovery. Do not make another lane or unrelated process absorb the stalled return.

Polling is state-driven:
- every tracked process declares one of: a readiness condition, expected completion, outer timeout, or explicit long-running-service classification,
- short command: one terminal status check,
- medium command: poll against an expected completion or readiness signal,
- long command: declare an interval before polling,
- read logs only on failure, changed output, or terminal completion,
- do not alternate status and logs without a state signal,
- after three unchanged polls, record exactly one transition: `WAIT_UNTIL <declared time or readiness signal>`, `PROCESS_STALL`, `RETURN_STALL`, `STALE_UI`, `CHANGE_MONITORING_STRATEGY`, `ESCALATE`, or `ABORT_AT <declared outer deadline>`,
- prohibit another unchanged poll until the declared time, readiness signal, changed process state, or recorded monitoring transition occurs,
- track one process ID and one log cursor,
- treat process exit and Kilo return as separate states,
- recover retained completed evidence before rerun.

If the adopted repo does not have a tracked background-process tool, keep return-critical execution parent-owned. Use a bounded synchronous fallback only for commands that do not require a real TTY, emit an immediate visible checkpoint before execution, and apply the same inspection, classification, retained-evidence, and ownership rules.

This doctrine limits damage and gives bounded detection and recovery. It does not repair a Kilo runtime defect.

### Concrete forbidden shell-file-CRUD examples

Do not use shell commands such as:

- `echo "text" > file.md`
- `type nul > new-file.md`
- `cat <<EOF > file.md`
- `powershell Set-Content file.md "text"`
- `powershell Out-File file.md`
- `Copy-Item source.md destination.md` when used as an unverified shortcut
- `cp source.md destination.md` when used as an unverified shortcut
- `xcopy source destination` or `robocopy source destination` when scope and verification are not explicit
- `del file.md` or `Remove-Item file.md`

If the command would create new file content, overwrite content by redirection, append content, rename, move, or delete a file, it belongs to the file tool path instead.

If the command only copies existing files or directories from a verified source to a verified destination, it may use the controlled-copy exception below.

### Controlled copy operations

The current official MCP filesystem toolset exposes read, write, edit, directory, metadata, search, and move tools, but no dedicated safe copy primitive.

That gap does allow shell copy for copy-only work, but only under a strict controlled-copy contract.

Allowed controlled-copy use cases:

1. bulk workflow-surface salvage,
2. template-to-target bootstrap staging,
3. archive creation that preserves existing files verbatim,
4. binary or directory-tree copies where file-tool read/write would be lossy or truncation-prone.

Controlled-copy contract:

1. Verify the source path exists and is the intended source.
2. Verify the destination parent exists and is the intended target area.
3. Keep the command copy-only: no delete, no move, no content transform, no shell redirection.
4. Exclude generated/vendor/build directories unless they are explicitly in scope.
5. After copying, verify file count plus byte size or hash parity for the copied set.
6. Record the command and verification evidence before claiming success.

Acceptable examples when the contract is satisfied:

- `Copy-Item -Recurse -LiteralPath <source> -Destination <dest>`
- `robocopy <source> <dest> /E` with dry-run or explicit include/exclude controls and summary verification
- `cp -R <source> <dest>` on Unix-like systems with post-copy verification

Still forbidden:

- shell redirects such as `>` / `>>`, heredocs, `Set-Content`, `Out-File`, or command-generated file content,
- deletion commands such as `rm`, `del`, `Remove-Item`,
- move/rename commands used as a substitute for file-tool move,
- unverified copy into broad or ambiguous destinations,
- copy commands that also transform content without an explicit implementation plan.

---

## Failure Rule

If a command path is used to create/edit/delete/move file content, controlled copy lacks source/destination verification and post-copy proof, return-critical execution ignores parent ownership and bounded return recovery, or a GitHub mutation is accepted without non-interactive hosted-object readback, tool discipline has failed even if the command itself completed.

---

*This rule is part of the thin `.kilo` constitutional core.*
