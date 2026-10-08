# Errors and retries

Read the exit code and symbolic `error.code`. Error messages come from a fixed table; do not expect raw parser or storage exceptions. `error.retryable` says whether an unchanged retry might succeed. A retry never grants consent to share text.

| Code | Exit | Action |
|---|---:|---|
| `SHARING_NOT_CONFIRMED` | 2 | Ask the person whether their full entry text may go to your model provider. Pass `--share-with-agent` only after their yes. |
| `ACCOUNT_REQUIRED` | 2 | Use `summary` and select the account the person named. |
| `INVALID_CURSOR` | 2 | Keep the same account and source name, or start without a cursor. Previously submitted suggestions are skipped. |
| `INVALID_ARGUMENTS` | 2 | Check the command reference and `--help --json`. Size must be 1 to 200. |
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
| `INVALID_REASON` | Use one nonblank sentence, at most 300 characters and no newline. |
| `INVALID_LABEL` | Check the shipped schema, including field types, source, file version, ID syntax, extra fields, duplicate items and label count. |

On success, `data.duplicate: true` means the same submission was already accepted. Treat it as success without another write. If a call was interrupted after committing, resend the identical file with the same ID. If evidence was dropped, read the warning and use a verbatim quote in a later, deliberate new submission rather than silently changing a retry.
