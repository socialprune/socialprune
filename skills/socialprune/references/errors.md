# Errors and retries

Read the exit code and symbolic `error.code`. Error messages come from a fixed table; do not expect raw parser or storage exceptions. `error.retryable` says whether an unchanged retry might succeed. A retry never grants consent to share text.

`scan run` can finish with `status: "partial"`, a nonzero exit and a count-only final report carrying `data.stopDetail`; its fixed warning names the cause. Stored suggestions remain. Do not turn that into a success claim or switch endpoints, models or output modes. Resume the same plan only when the person has resolved the cause and still agrees to share there.

Before any request, a live run requires the answering model recorded by a successful `scan check` in its named source file. Wrong origin/model confirmations or a missing or configuration-stale check give `ENDPOINT_NOT_CONFIRMED`, name the supplied and recorded values, and ask for `scan check` followed by a fresh dry-run plan. They send zero requests and open no key. A re-check changes the plan hash, so an old plan gives `STALE_PLAN` even when the new confirmation matches. After those offline gates, the live invented probe remains: `MODEL_CHANGED` reports `source.confirmedModel` separately from actual `source.answeringModel`, uses null without an answer, and leaves `coverageCounted: false` and `entries: null`. Nothing from the workspace was sent or stored. A dry run remains network-free and uses the recorded model when its check matches the current configuration/rubric; without it counts are explicitly provisional. Only a matching observed model supplies live coverage identity.

| Code | Exit | Action |
|---|---:|---|
| `SOURCE_FILE_INVALID`, `SOURCE_PATH_REFUSED`, `KEY_FILE_INVALID` | 2 | Use the person's explicit source and separate one-line key files outside repositories. Never search for a replacement or open another tool's configuration. |
| `ENDPOINT_NOT_CONFIRMED`, `STALE_PLAN` | 2 or 1 | Show a fresh check and dry-run to the person; use their origin/model agreement and the unchanged plan. |
| `ENDPOINT_UNREACHABLE`, `ENDPOINT_UNAUTHORIZED`, `MODEL_NOT_FOUND` | 1 | Let the person correct their endpoint, selected model or key file. Never select another service. |
| `MODEL_CHANGED`, `REMOTE_MODEL`, `STRUCTURED_OUTPUT_REFUSED`, `REDIRECT_REFUSED` | 1 | Stop. No silent provider, model, remote-model or output-mode fallback is permitted. |
| `ANSWERS_INVALID`, `ENDPOINT_RETRY_EXHAUSTED`, `ENDPOINT_RATE_LIMITED`, `SCAN_FAILED` | 1 | Read aggregate stop counts, retain the plan and resume later only after resolving the cause. |
| `SHARING_NOT_CONFIRMED` | 2 | Ask the person whether their full entry text may go to your model provider. Pass `--share-with-agent` only after their yes. |
| `ACCOUNT_REQUIRED` | 2 | Use `summary` and select the account the person named. |
| `INVALID_CURSOR` | 2 | Keep the same account and source name, or start without a cursor. Previously submitted suggestions are skipped. |
| `INVALID_ARGUMENTS` | 2 | Check the command reference and `--help --json`. Size must be 1 to 200. |
| `X_WARNING_DAY`, `X_WARNING_CARD_REQUIRED` | 2 | Stop the deletion handoff. The person must receive the parent's card, wait until the next workspace day and type the exact run-named acknowledgement in their own terminal. Never acknowledge for them or retry deletion automatically. |
| `X_WARNING_RESTORE_BLOCKED` | 2 | Restore cannot replace an outstanding warning workspace. The person first reads the card and uses `delete x --acknowledge-warning <runId> --profile <dir>` themselves. Never clear the marker or acknowledge for them. |
| `IG_WARNING_DAY`, `IG_WARNING_CARD_REQUIRED` | 2 | Stop the deletion handoff. The person waits until the next workspace day, reads the Instagram warning card and types the exact run-named acknowledgement in their own terminal. Never acknowledge for them or retry deletion automatically. |
| `IG_WARNING_RESTORE_BLOCKED` | 2 | Restore cannot replace a workspace with an outstanding Instagram warning. The person reads the card and uses `delete instagram --acknowledge-warning <runId> --profile <dir>` themselves. Never clear the marker or acknowledge for them. |
| `INVALID_LABELS` | 1 | Correct every indexed failure below, preview again, then submit. No labels were written. |
| `SUBMISSION_CONFLICT` | 1 | Do not overwrite the recorded submission. Verify which file was already accepted. If this is a deliberate new set of suggestions, use a new ID; do not hide an accidental changed retry. |
| `WORKSPACE_BUSY` | 1 | Retry later with the same file and submission ID after the competing command finishes. Do not remove locks or edit the database. |
| `NODE_TOO_OLD` | 1 | The person needs Node.js 24.15 or newer before workspace commands run. |
| `MISSING_WORKSPACE` | 2 | Check the exact directory the person supplied. Import can create a missing or empty workspace. |
| `WORKSPACE_SCHEMA_UNSUPPORTED`, `BACKUP_SCHEMA_UNSUPPORTED` | 3 | Use a version that can read the schema. Do not change a version field by hand. |
| `IO_ERROR`, `STORAGE_FULL`, `WORKSPACE_INVALID` | 1 | Let the person correct the file, storage or workspace problem. Do not alter workspace files. |
| `UNKNOWN_FORMAT` | 3 | This version cannot read that export. Do not improvise a parser or platform action. |
| `HTML_EXPORT` | 1 | The person requests a JSON export themselves. |
| `PARTIAL_IMPORT` | 4 | Explain the counts and diagnostics. Rerunning import is possible, but never claim omitted entries were read. |
| `BROWSER_OPEN_FAILED`, `NO_TOKEN_CHANNEL` | 1 or 2 | The person runs `review` in their own terminal. Never add `--no-open` or seek the token. |
| `REVIEW_ASSETS_MISSING` | 1 | From the repository, build with `pnpm --filter @socialprune/web build:review` before handing over. |
| `CANCELLED`, `BATCH_FAILED`, `LABELS_FAILED` | 1 | Stop, explain the fixed error and correct its cause. Do not assume a failed response means nothing was recorded; retry a label file unchanged to check idempotency. |

`INVALID_LABELS.details.failures` uses only these codes:

Indexes 0 to `n-1` name labels in the file's array; `-1` means a whole-file failure, so fix the file as a whole rather than label 0.

| Failure code | Correction |
|---|---|
| `UNKNOWN_ITEM` | Copy an existing `itemId` from a fresh batch. |
| `CONTENT_CHANGED` | Read the current text and hash, then reconsider the suggestion. Do not replace only the hash. |
| `UNKNOWN_CATEGORY` | Choose from the batch's category list. |
| `CATEGORY_NOT_CHECKED` | Name an applying category only if it is in the file's checked criteria; use a fresh batch rather than adding a criterion you did not assess. Earlier restored categories are not rechecked. |
| `CRITERION_CHANGED` | Fetch the current definition and hash, reread the affected entries and reconsider the labels. Do not replace only the hash. Restart batching without the old cursor. |
| `INVALID_REASON` | Use one nonblank sentence, at most 300 characters and no newline. |
| `INVALID_LABEL` | Check the shipped schema, including field types, agent source, file version, ID syntax, extra fields, duplicate item/category pairs, mixed exclusive outcomes and assessment count. Version 1 still permits only one label per item. |

On success, `data.duplicate: true` means the same submission was already accepted. Treat it as success without another write. If a call was interrupted after committing, resend the identical file with the same ID. If evidence was dropped, read the warning and use a verbatim quote in a later, deliberate new submission rather than silently changing a retry.
