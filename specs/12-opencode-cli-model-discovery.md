# Spec 12: OpenCode CLI Model Discovery

## Overview

Discover available models for OpenCode by executing the `opencode models` CLI command instead of fetching from models.dev. This provides an accurate, locally-relevant model list that reflects the user's configured providers rather than the full 100+ model catalog.

## Problem

When `listModels({ cli: 'opencode' })` is called, the current implementation returns **all** models from models.dev (100+ across all providers) because `CLI_PROVIDER_MAP` maps `opencode` to `null` (no provider filter). This list is too long and includes models the user hasn't configured. OpenCode's own `opencode models` command returns only the models actually available to the user.

## Scope

### In scope
- New module `src/core/cli-models.ts` to execute and parse `opencode models`
- In-memory cache with 24h TTL (same pattern as `models-catalog.ts`)
- Concurrent request deduplication
- Error types for command failures
- Unit tests with mocked `execCommand`

### Out of scope
- Parsing `--verbose` output for metadata (context window, costs)
- CLI-based model discovery for Claude Code or Codex
- Filesystem caching
- Fallback to models.dev when CLI fails

## User Stories

- **As a spawner consumer**, I can call `listModels({ cli: 'opencode' })` and receive only the models available in my OpenCode installation, so that I can present a relevant model picker.

## Business Rules

1. The `opencode models` command outputs one model per line in `provider/model-id` format (e.g., `anthropic/claude-sonnet-4-20250514`).
2. Empty lines in the output are ignored.
3. The full `provider/model-id` string is used as both `id` and `name` on `KnownModel`.
4. The provider is extracted by splitting on the first `/` character.
5. `contextWindow` is always `null` and `supportsEffort` is always `false` (no metadata available from basic output).
6. Results are cached in-memory with a 24-hour TTL.
7. Concurrent calls share a single inflight subprocess (deduplication).
8. If the CLI command fails, the error propagates — no fallback to models.dev or stale cache.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `opencode` binary not found (ENOENT) | Throw `CliModelsFetchError` with `kind: 'enoent'` |
| Command times out (>10s) | Throw `CliModelsFetchError` with `kind: 'timeout'` |
| Generic spawn error | Throw `CliModelsFetchError` with `kind: 'error'`, include cause |
| Non-zero exit code | Throw `CliModelsFetchError` with `kind: 'exit_code'`, include stderr in message |
| Empty stdout (no models) | Return empty `KnownModel[]` |
| Line without `/` separator | Use full line as `id`, `name`, and `provider` (degenerate case) |
| Trailing newline / blank lines | Filtered out during parsing |
| Cache expired + fetch fails | Error propagates (no stale cache fallback) |

## Data Model

```typescript
// New error class
export class CliModelsFetchError extends Error {
  readonly kind: 'enoent' | 'timeout' | 'exit_code' | 'error';

  constructor(
    message: string,
    kind: CliModelsFetchError['kind'],
    options?: { cause?: Error },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'CliModelsFetchError';
    this.kind = kind;
  }
}

// Cache structure — intentionally omits `stale` field since there is no
// stale cache fallback (unlike ModelsCache for models.dev).
export interface CliModelsCache {
  data: KnownModel[];
  fetchedAt: number;
}
```

## API / Interface

```typescript
// src/core/cli-models.ts

import { execCommand } from './detect.js';
import type { ExecResult } from './detect.js';
import type { KnownModel } from '../types.js';
import { createDebugLogger } from './debug.js';

export const CLI_MODELS_CACHE_TTL_MS: number; // 24 * 60 * 60 * 1000

/**
 * Execute `opencode models` and parse stdout into KnownModel[].
 * Does NOT use cache — always spawns a subprocess.
 *
 * @throws CliModelsFetchError on ENOENT, timeout, non-zero exit, or generic spawn error
 */
export async function fetchCliModels(): Promise<KnownModel[]>;

/**
 * Return cached models if fresh, otherwise fetch and cache.
 * Concurrent calls are deduplicated to a single subprocess.
 * Unlike ensureCache() in models-catalog.ts, does NOT return stale cache on failure.
 *
 * @throws CliModelsFetchError if fetch fails (always — no stale fallback)
 */
export async function ensureCliModelsCache(): Promise<CliModelsCache>;

/**
 * Force-refresh the cache by running `opencode models`.
 *
 * @throws CliModelsFetchError on failure (cache is NOT updated on error)
 */
export async function refreshCliModelsCache(): Promise<CliModelsCache>;

/** Clear the in-memory cache. */
export function clearCliModelsCache(): void;

/** Return current cache state (for testing). */
export function getCliModelsCache(): CliModelsCache | null;
```

### Type guard for execCommand result

Use the same `isExecResult` pattern established in the adapter modules:

```typescript
function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}
```

### fetchCliModels implementation shape

```typescript
async function fetchCliModels(): Promise<KnownModel[]> {
  const result = await execCommand('opencode', ['models']);

  if (!isExecResult(result)) {
    // ExecError — discriminate by kind
    switch (result.kind) {
      case 'enoent':
        throw new CliModelsFetchError('opencode binary not found', 'enoent');
      case 'timeout':
        throw new CliModelsFetchError('opencode models timed out', 'timeout');
      case 'error':
        throw new CliModelsFetchError('opencode models failed to spawn', 'error', {
          cause: result.error instanceof Error ? result.error : new Error(String(result.error)),
        });
    }
  }

  if (result.exitCode !== 0) {
    // Include stderr in the error message for debugging
    const detail = result.stderr ? `: ${result.stderr}` : '';
    throw new CliModelsFetchError(
      `opencode models exited with code ${result.exitCode}${detail}`,
      'exit_code',
    );
  }

  return parseCliModelsOutput(result.stdout);
}
```

### Parsing logic

```typescript
function parseCliModelsOutput(stdout: string): KnownModel[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const slashIndex = line.indexOf('/');
      const provider = slashIndex > 0 ? line.substring(0, slashIndex) : line;
      return {
        id: line,
        name: line,
        provider,
        contextWindow: null,
        supportsEffort: false,
      };
    });
}
```

## Architecture

- **New file:** `src/core/cli-models.ts`
- **Depends on:** `execCommand` from `src/core/detect.ts`, `KnownModel` from `src/types.ts`, `createDebugLogger` from `src/core/debug.ts`
- **Depended on by:** `src/models.ts` (spec 13)
- **Pattern:** Mirrors `models-catalog.ts` — same cache/inflight/TTL structure for consistency

## Acceptance Criteria

- Given OpenCode is installed and configured, when `fetchCliModels()` is called, then it returns a `KnownModel[]` parsed from `opencode models` stdout.
- Given the output line `anthropic/claude-sonnet-4-20250514`, when parsed, then the model has `id: 'anthropic/claude-sonnet-4-20250514'`, `name: 'anthropic/claude-sonnet-4-20250514'`, `provider: 'anthropic'`, `contextWindow: null`, `supportsEffort: false`.
- Given a fresh cache exists (< 24h), when `ensureCliModelsCache()` is called, then no subprocess is spawned.
- Given two concurrent calls to `ensureCliModelsCache()`, then only one subprocess is spawned.
- Given `opencode` is not installed, when `fetchCliModels()` is called, then `CliModelsFetchError` is thrown with `kind: 'enoent'`.
- Given the command times out, when `fetchCliModels()` is called, then `CliModelsFetchError` is thrown with `kind: 'timeout'`.
- Given the command exits with code 1, when `fetchCliModels()` is called, then `CliModelsFetchError` is thrown with `kind: 'exit_code'`.
- Given a generic spawn error occurs, when `fetchCliModels()` is called, then `CliModelsFetchError` is thrown with `kind: 'error'` and the original error as `cause`.
- Given the command exits with code 1 and stderr output, when `CliModelsFetchError` is thrown, then the error message includes the stderr content.

## Testing Strategy

**Test file:** `test/core/cli-models.test.ts`

**Mocking pattern:** Mock `node:child_process` `spawn` via `vi.mock()` before importing the module (same pattern as `test/core/detect.test.ts`), using mock process helpers from `test/helpers/mock-process.ts`.

**Test cases:**
- Parse valid multi-line stdout into `KnownModel[]`
- Parse empty stdout into empty array
- Parse lines without `/` separator (degenerate case)
- ENOENT error → `CliModelsFetchError` with `kind: 'enoent'`
- Timeout error → `CliModelsFetchError` with `kind: 'timeout'`
- Generic spawn error → `CliModelsFetchError` with `kind: 'error'`
- Non-zero exit code → `CliModelsFetchError` with `kind: 'exit_code'`, message includes stderr
- Cache hit within TTL (no subprocess spawned)
- Cache TTL expiry triggers re-fetch (use `vi.useFakeTimers()` + `vi.advanceTimersByTime()`)
- Concurrent deduplication (two calls, one subprocess)
- `refreshCliModelsCache()` always fetches, throws on failure
- `clearCliModelsCache()` invalidates cache
