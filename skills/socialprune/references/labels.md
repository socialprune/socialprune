# Label file

The canonical JSON Schema is `schemas/label-file.schema.json`, listed by `socialprune schemas --json` and generated from the core `LabelFileSchema`. In the source repository it lives at `packages/core/schemas/label-file.schema.json`. This reference explains that schema; it does not define a second one.

```json
{
  "schemaVersion": 2,
  "submissionId": "agent-run-7-batch-3",
  "source": { "kind": "agent", "name": "agent", "version": null },
  "criteria": [{ "id": "<copy checked criterion ID from batch>", "hash": "<copy its hash>" }],
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

`criteria` lists only what you actually checked for every item covered by this file. Copy each `id` and `hash` from the batch, once per criterion. There are at most 32. Do not put `harmless` or `unclear` in this list. A subset supports a later run for one own criterion without replacing checks for other criteria. Every definition hash must still be current at submission and at commit. A changed description needs a fresh read and assessment, not just a replacement hash.

`labels` contains 1 to 1,000 assessments, not necessarily that many distinct items. Every item ID must exist, and its text hash must match the stored text. The file may label any existing item; no issued batch or lease is required. The same item may have one label per applying checked criterion. Repeating an item and category pair is invalid. `harmless` and `unclear` each stand alone for that item, never beside each other or another label. Absence of a hit means clear only for the file's named criteria and covered items.

Use a category from the file's checked criteria, or `harmless` or `unclear`. Read the returned definition, including its exclusions. `categories` is the legacy workspace list, not proof that a criterion was checked. `risk` is an integer from 0 to 3 for that category. `reason` is one nonblank sentence of at most 300 characters, without a newline. `confidence` is `null` or a number from 0 to 1. `evidence` is `null` or a verbatim substring of the item's full text. Nonverbatim evidence is dropped and counted in a warning, not used to reject the file.

Older version-1 files still work for the eight legacy defaults other than `harmless` and `unclear`. They keep one label per item and cannot carry a `criteria` field. They never count as checking the four new presets, an own criterion or an earlier restored category. Use version 2 for new work.

Read each entry before labelling it. A label at risk 2 or 3 comes from reading that one entry and includes evidence quoted verbatim from its text. Never produce these labels with keyword rules, scripts or bulk templates. Write each reason for that entry, not from a reused bulk reason. When the text alone is not enough to judge, such as irony or a reply whose context is missing, use `unclear` with risk 0 or 1 instead of guessing.

The file schema still permits `evidence: null`. Both `labels submit` and its dry-run warn with a count when submitted labels at risk 2 or 3 have null evidence; they do not reject the file. Read the warning, reread those entries, and add their verbatim quotes or lower their risk when the text does not support the suggestion.

All objects reject extra fields. There is no decision, outcome, human source, `via` or instruction field. Write the file outside the workspace and preview it with `labels submit --dry-run --json` before submission.

An invalid file returns `INVALID_LABELS` with `details.failures`, a list of fixed `code` values and zero-based label indexes. Index `-1` means the file as a whole; fix its version, source, submission ID, count or shape, not label 0. No reason, evidence, text or file path appears in those details. Correct the file using the error table, not by editing the workspace.
