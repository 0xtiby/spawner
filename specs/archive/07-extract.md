---
title: "Spec: Extract"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, extract]
---

# Extract

## Overview

Synchronous post-hoc extraction of `CliResult` from saved raw output. Uses the same parsing logic as the stream layer but runs over a complete string instead of a live process.

**Source:** `src/core/extract.ts`

## Scope

**In:** Parsing a complete raw output string, reusing adapter `parseLine()`, building a `CliResult`.

**Out:** Live streaming, process management.

---

## Public API

```typescript
interface ExtractOptions {
  cli: CliName;
  rawOutput: string;
}

function extract(options: ExtractOptions): CliResult;
```

Synchronous. Takes the CLI name and the full raw output (as would have been captured from stdout), returns a `CliResult`.

---

## Implementation

1. Split `rawOutput` by newlines
2. Create a fresh `SessionAccumulator`
3. For each line, call `adapter.parseLine(line, accumulator)`
4. After all lines are processed, build `CliResult` from the accumulator:

```typescript
{
  exitCode: 0,              // Assumed success (we don't have exit code from saved output)
  sessionId: accumulator.sessionId,
  usage: {
    inputTokens: accumulator.inputTokens || null,
    outputTokens: accumulator.outputTokens || null,
    totalTokens: (accumulator.inputTokens + accumulator.outputTokens) || null,
    cost: accumulator.cost,
  },
  model: accumulator.model,
  error: null,              // No error classification without exit code + stderr
  durationMs: 0,            // Unknown from saved output
}
```

### Limitations

- `exitCode` defaults to 0 (no process exit info available)
- `error` is always null (no stderr available for classification)
- `durationMs` is 0 (no timing info available)

These are acceptable — `extract()` is for replaying saved output to get metadata, not for full process reconstruction.

---

## Use Cases

- **Log replay:** Parse saved JSONL logs to extract session ID, model, and token usage
- **Testing:** Verify parser output against known fixtures
- **Analytics:** Extract usage data from stored CLI output

---

## Acceptance Criteria

- Given valid Claude JSONL output with a `result` line, when `extract()` is called, then it returns a `CliResult` with correct `sessionId`, `model`, and `usage`
- Given valid Codex NDJSON output, when `extract()` is called, then it returns a `CliResult` with extracted metadata
- Given empty string input, when `extract()` is called, then it returns a `CliResult` with all null/zero fields
- Given malformed JSONL (some lines invalid), when `extract()` is called, then it still extracts what it can from valid lines (no throw)
- Given output with no session ID or usage data, when `extract()` is called, then `sessionId` is null and usage fields are null
