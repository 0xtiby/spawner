---
title: "Spec: Error Classification"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, errors]
---

# Error Classification

## Overview

Classify CLI errors from exit codes and stderr/stdout patterns into typed `CliError` objects. Each adapter ships regex patterns mapped to error codes.

**Source:** `src/core/errors.ts` (public `classifyError` function) + each adapter's `classifyError()` method.

## Scope

**In:** Pattern matching on stderr/stdout, exit code interpretation, retryable classification, retry-after hints.

**Out:** Error recovery, retry logic (that's the app's job).

---

## Public API

```typescript
function classifyError(cli: CliName, exitCode: number, stderr: string, stdout: string): CliError;
```

Delegates to the appropriate adapter's `classifyError()`.

---

## Classification Heuristics

Errors are classified by matching regex patterns against stderr and stdout. Patterns are checked in priority order — first match wins.

### Pattern table (shared across adapters)

| Code | Patterns (case-insensitive) | Retryable | retryAfterMs |
|------|----------------------------|-----------|--------------|
| `rate_limit` | `rate limit`, `too many requests`, `429`, `try again`, `overloaded` | `true` | `60000` |
| `auth` | `not authenticated`, `login`, `sign in`, `401`, `unauthorized`, `auth` | `false` | `null` |
| `session_not_found` | `session not found`, `no such session`, `invalid session` | `false` | `null` |
| `model_not_found` | `model not found`, `unknown model`, `invalid model` | `false` | `null` |
| `context_overflow` | `context length`, `too long`, `token limit`, `context window` | `false` | `null` |
| `permission_denied` | `permission`, `approve`, `confirm` | `false` | `null` |

### Per-adapter overrides

Each adapter may add CLI-specific patterns or adjust the shared patterns. For example:

- **Claude:** `auth` also matches exit code 1 from `claude auth status`
- **Codex:** `permission_denied` matches when the process appears to hang waiting for stdin approval (detected by timeout + no output)

### Fallback

If no pattern matches:
- Non-zero exit code → `{ code: 'fatal', retryable: false }`
- Cannot determine → `{ code: 'unknown', retryable: false }`

### ENOENT (special case)

Binary not found is classified at the spawn level, not by the adapter:
- `{ code: 'binary_not_found', retryable: false, message: '<cli> binary not found' }`

---

## CliError Construction

```typescript
{
  code: CliErrorCode,
  message: string,         // Human-readable summary (first matching line or default)
  retryable: boolean,
  retryAfterMs: number | null,
  raw: string,             // The full stderr + stdout that was analyzed
}
```

The `message` field should be concise — extract the most relevant line from stderr/stdout, not dump the entire output. The `raw` field contains the full text for the app to inspect if needed.

---

## Acceptance Criteria

- Given stderr contains "rate limit exceeded", when `classifyError()` is called, then it returns `{ code: 'rate_limit', retryable: true, retryAfterMs: 60000 }`
- Given stderr contains "not authenticated", when `classifyError()` is called, then it returns `{ code: 'auth', retryable: false }`
- Given stderr contains "session not found", when `classifyError()` is called, then it returns `{ code: 'session_not_found', retryable: false }`
- Given a non-zero exit code with no matching patterns, when `classifyError()` is called, then it returns `{ code: 'fatal', retryable: false }`
- Given an ENOENT spawn error, when the error is classified, then it returns `{ code: 'binary_not_found' }`
- Given stderr contains multiple matching patterns, when `classifyError()` is called, then the first match in priority order wins
- Given the `raw` field, when the error is returned, then it contains the full stderr + stdout concatenated
