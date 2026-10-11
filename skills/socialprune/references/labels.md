# Label file

The canonical JSON Schema is `schemas/label-file.schema.json`, listed by `socialprune schemas --json` and generated from the core `LabelFileSchema`. In the source repository it lives at `packages/core/schemas/label-file.schema.json`. This reference explains that schema; it does not define a second one.

```json
{
  "schemaVersion": 1,
  "submissionId": "agent-run-7-batch-3",
  "source": { "kind": "agent", "name": "agent", "version": null },
  "labels": [
    {
      "itemId": "<copy from batch>",
      "contentHash": "<copy from batch>",
      "category": "harmless",
      "risk": 0,
      "reason": "A plain status update with no personal details",
      "evidence": null,
      "confidence": null
    }
  ]
}
```

Replace the placeholders with returned values. `submissionId` has 1 to 128 ASCII letters, digits, dots, underscores or hyphens. `source.kind` is exactly `agent`, `name` is nonempty, and `version` is text or `null`. Keep the source name used for batching.

`labels` contains 1 to 1,000 entries. Every item ID must exist, and its hash must match the stored text. The file may label any existing item; no issued batch or lease is required. Repeating an item ID within a file is invalid.

Use a category from the returned workspace list. `risk` is an integer from 0 to 3. `reason` is one nonblank sentence of at most 300 characters, without a newline. `confidence` is `null` or a number from 0 to 1. `evidence` is `null` or a verbatim substring of the item's full text. Nonverbatim evidence is dropped and counted in a warning, not used to reject the file.

Read each entry before labelling it. A label at risk 2 or 3 comes from reading that one entry and includes evidence quoted verbatim from its text. Never produce these labels with keyword rules, scripts or bulk templates. Write each reason for that entry, not from a reused bulk reason. When the text alone is not enough to judge, such as irony or a reply whose context is missing, use `unclear` with risk 0 or 1 instead of guessing.

The file schema still permits `evidence: null`. Both `labels submit` and its dry-run warn with a count when submitted labels at risk 2 or 3 have null evidence; they do not reject the file. Read the warning, reread those entries, and add their verbatim quotes or lower their risk when the text does not support the suggestion.

All objects reject extra fields. There is no decision, outcome, human source, `via` or instruction field. Write the file outside the workspace and preview it with `labels submit --dry-run --json` before submission.

An invalid file returns `INVALID_LABELS` with `details.failures`, a list of fixed `code` values and zero-based label indexes. Index `-1` means the file as a whole; fix its version, source, submission ID, count or shape, not label 0. No reason, evidence, text or file path appears in those details. Correct the file using the error table, not by editing the workspace.
