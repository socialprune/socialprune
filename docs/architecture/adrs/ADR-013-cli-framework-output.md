# ADR-013: CLI framework, command tree and machine output contract

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 3 (no approve command), 2 (no network from CLI commands in Phase 2)
- **Related:** [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-018](ADR-018-cli-distribution.md)

## Context

The Phase 1 CLI has one command, `structure`, parsed with `node:util.parseArgs` and dispatched in `apps/cli/src/main.ts`. Phase 2 adds about ten commands, several with subcommands, that people and agents both use. Agents need one predictable machine format, stable exit codes and error codes, help they can parse, and no prompts. `packages/core` already exports `EXIT_CODES` (`ok` 0, `error` 1, `usage` 2, `unknownFormat` 3, `partial` 4) and `importExitCode`, which maps an HTML export to 1.

Eight frameworks were bundled with esbuild 0.28.2 on 2026-10-06 around the same tiny command (one positional, `--json`, `--dry-run`, help, an unknown flag):

| Framework | License | JS / gzip | Notes |
|---|---|---:|---|
| `node:util.parseArgs` | Node core | 566 / 364 B | manual routing and help |
| citty 0.2.2 | MIT | 8,371 / 3,474 B | accepted an unknown flag in the tested path |
| cac 7.0.0 | MIT | 10,819 / 4,020 B | option object unchecked |
| @stricli/core 1.3.0 | Apache-2.0 | 30,722 / 10,155 B | definition and implementation signatures checked by `tsc`; nested routes; generated help; zero dependencies |
| commander 15.0.0 | MIT | 39,529 / 11,386 B | `opts<T>()` is a caller assertion |
| clipanion 3.2.1 | MIT | 54,257 / 16,725 B | last stable release 2023-06-05 |
| cmd-ts 0.15.0 | MIT | 58,782 / 17,272 B | strong inference, larger graph |
| yargs 18.2.0 | MIT | 112,183 / 34,947 B | largest |

Stricli's default parse error sets exit code `-4`, which Windows reported as 4,294,967,292. Its `versionInfo` option can fetch a latest-version URL. A contract probe with an injected `context.process` mapped parser errors to 2 and emitted one JSON error document; with no version checker configured, success, dry-run, bad flag and help made zero fetch attempts.

## Decision Drivers

- One registry of commands drives parsing, human help and machine help, so they cannot drift.
- Exit codes keep the existing public meaning; symbolic error codes carry detail.
- `--json` means exactly one JSON document on stdout.
- No prompts, no network, no update checks.

## Options

### Option 1: @stricli/core 1.3.0 with a SocialPrune execution adapter

**Pros:**
- `tsc` checks that each command's parameters match its implementation; nested routes and generated help; Apache-2.0 with zero dependencies.
- Isolated context injection makes handlers testable without spawning processes.

**Cons:**
- Needs an adapter for exit codes and JSON errors, and machine help is ours to generate.
- The installed npm package contained no LICENSE file; the notice comes from the `v1.3.0` repository tag.

**Effort:** not measured
**Risk:** Low.

### Option 2: `node:util.parseArgs` with an app-owned registry

**Pros:**
- No dependency; 566 bytes.
- Already used in Phase 1.

**Cons:**
- Routing, help generation and per-command type inference are ours to write and test.
- Nested commands such as `batch next` and `labels submit` need hand-written dispatch.

**Effort:** not measured
**Risk:** Medium.

### Option 3: commander 15.0.0

**Pros:**
- The most familiar CLI library for contributors.
- Extensive help and custom IO.

**Cons:**
- Options are typed by caller assertion, not inferred from definitions.
- 11,386 B gzip versus 10,155 B for Stricli with weaker checking.

**Effort:** not measured
**Risk:** Low.

## Decision

We chose **Option 1: @stricli/core 1.3.0 with a SocialPrune execution adapter**, because it is the smallest option that type-checks command definitions against their handlers and generates help from one registry.

### Command tree for Phase 2

| Command | Writes | `--dry-run` |
|---|---|---|
| `guide <x\|instagram> [--lang de\|en]` | no | n/a |
| `structure <path…>` | no | n/a |
| `import <path…> --workspace <dir>` | workspace | yes |
| `summary --workspace <dir>` | no | n/a |
| `batch next --workspace <dir> --share-with-agent [--account <key>] [--size <n>] [--cursor <c>] [--source-name <name>]` | no | n/a |
| `labels submit <file> --workspace <dir>` | assessments | yes |
| `review --workspace <dir> [--no-open]` | through the browser only | yes |
| `export clicklist --workspace <dir> --platform <x\|instagram> --out <file> [--format csv\|json\|ndjson] [--time-zone <IANA>]` | output file | yes |
| `backup export --workspace <dir> --out <file>` | output file | yes |
| `backup restore <file> --workspace <dir>` | workspace | yes |
| `schemas` | no | n/a |

`scan` (Phase 2a) and `mcp` (0.2) are reserved names and print "not available in this version" with exit 2. There is no `approve`, `decide`, `delete` or `mark` command, and no option on any command that writes a decision or outcome event.

### Execution adapter

- Parser errors map to exit 2 with code `INVALID_ARGUMENTS`. No negative exit code ever leaves the process.
- No `versionInfo`, no update check, no network access in any Phase 2 command. A test runs every command, including `review --dry-run` and a bad flag, with these replaced by recorders and asserts zero calls: global `fetch` and `WebSocket`; `http.request` and `http.get`; `https.request` and `https.get`; `http2.connect`; `net.connect` and `net.createConnection`; `tls.connect`; `dns.lookup` and every `dns.resolve*` function, in both `node:dns` and `node:dns/promises`; `dgram.createSocket`. The only listening socket is the one `review` binds on `127.0.0.1` ([ADR-016](ADR-016-local-review-server.md)); its own test asserts that address. The browser opener is a recorder in every test.
- Handlers receive a context with clock, IO streams, `AbortSignal` and the workspace service. They never touch `process.argv`, `process.exit`, `console` or environment variables.
- `main.ts` only wires the adapter; importing any CLI module has no side effects.

### Exit codes

| Code | Meaning | Examples of symbolic codes |
|---|---|---|
| 0 | done | |
| 1 | runtime error, including retryable conditions | `WORKSPACE_BUSY` (retryable), `INVALID_LABELS`, `SUBMISSION_CONFLICT`, `STORAGE_FULL`, `HTML_EXPORT`, `NODE_TOO_OLD`, `BROWSER_OPEN_FAILED` |
| 2 | wrong usage | `INVALID_ARGUMENTS`, `INVALID_CURSOR`, `MISSING_WORKSPACE`, `SHARING_NOT_CONFIRMED`, `NO_TOKEN_CHANNEL`, `NOT_AVAILABLE` |
| 3 | input format not readable by this version | `UNKNOWN_FORMAT`, `WORKSPACE_SCHEMA_UNSUPPORTED`, `BACKUP_SCHEMA_UNSUPPORTED` |
| 4 | partial read: some data imported, some not | `PARTIAL_IMPORT` |

Code 3 now also covers workspace and backup files written by a newer schema version. Code 4 keeps its meaning and is never reused for other states.

### Output contract

- **Human mode** (default): results on stdout as plain text without ANSI colors; progress, warnings and notices on stderr. Any export text printed to a terminal has control characters and ANSI sequences removed first.
- **`--json`**: exactly one JSON document on stdout, then exit. Nothing else on stdout. Progress stays on stderr as plain lines.

```json
{"schemaVersion":1,"command":"summary","status":"ok","workspace":{"id":"…","revision":12},"data":{},"warnings":[]}
{"schemaVersion":1,"command":"labels.submit","status":"error","error":{"code":"INVALID_LABELS","message":"Some labels did not pass validation. Nothing was written.","exitCode":1,"retryable":false,"details":{"failures":[{"index":3,"code":"CONTENT_CHANGED"}]}}}
```

  `status` is `ok`, `partial` or `error`. `message` is English, from a fixed table, never from a raw exception. `details` holds IDs and counts, never export text or file system paths beyond those the person passed.
- **NDJSON** only where asked with `--format ndjson` (click-list export). Each line has `schemaVersion`, `command`, `operationId`, `seq` and `type`; the stream ends with exactly one `complete` or `error` line, so a missing terminal line means the output is incomplete.
- **Long-running `review`**: one readiness document with `data.lifecycle: "running"`, then nothing more on stdout ([ADR-016](ADR-016-local-review-server.md)).
- **`--dry-run`**: a complete description of what would happen, with counts, and no writes, no workspace creation, no lock left behind, no server, no browser.
- **`--help --json`**: command path, description, positionals, options with types and defaults, output schema IDs, whether it writes, and the exit map. Generated from the same registry as human help.
- **`schemas`** lists the shipped schema IDs and their package-relative paths. Schemas ship in the npm package ([ADR-018](ADR-018-cli-distribution.md)): the core v2 schemas ([ADR-006](ADR-006-workspace-event-log.md)) plus result, error, batch, label submission, summary, click list and review readiness, generated from zod with the existing drift check.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- Agents get one document per call, stable exit and error codes, and schemas to validate against.
- Commands are unit-testable through injected context, without spawning processes.

### Negative
- A runtime dependency in the bundle (10 KB gzip in the sample) and an adapter we maintain.
- English-only human output in Phase 2 except `guide` ([ADR-011](ADR-011-internationalization.md)).

### Risks
- **A Stricli update changes its error path.** Mitigation: adapter tests assert every exit code and the single-document rule for each command, including a bad flag.
- **An error message leaks export text.** Mitigation: messages come from a fixed table; a test feeds the X `injection` fixture through every failing path of every command and asserts none of its strings appear on stdout or stderr. The CLI owner writes that test with the output adapter.

## Evidence

- Framework bundle table and Stricli contract probe: [evidence-2026-10.md, section 7](../evidence-2026-10.md#7-cli-bundles-and-framework).
- clig.dev contributors, [Command Line Interface Guidelines](https://clig.dev/), living; ndjson-spec maintainers, [NDJSON 1.0.0](https://raw.githubusercontent.com/ndjson/ndjson-spec/master/README.md); Bloomberg, [Stricli docs](https://bloomberg.github.io/stricli/docs/quick-start) and [v1.3.0 LICENSE](https://raw.githubusercontent.com/bloomberg/stricli/v1.3.0/LICENSE). All observed 2026-10-06.
