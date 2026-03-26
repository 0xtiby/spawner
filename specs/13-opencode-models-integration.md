# Spec 13: OpenCode Models Listing Integration

## Overview

Wire the CLI-based model discovery from spec 12 into the existing `listModels` / `getKnownModels` / `refreshModels` public API so that OpenCode uses `opencode models` instead of models.dev, while Claude Code and Codex continue using models.dev unchanged.

## Problem

The `listModels` function currently routes all CLIs through the models.dev catalog. For OpenCode, this returns 100+ models from all providers. We need to branch the data source: OpenCode uses CLI discovery (spec 12), others use models.dev.

## Scope

### In scope
- Update `listModels()` in `src/models.ts` to branch on `cli='opencode'`
- Support `provider` filtering on CLI-sourced models
- Silently ignore `fallback` parameter for OpenCode
- Update `refreshModels()` to handle OpenCode cache refresh
- Update tests for `src/models.ts`

### Out of scope
- Changes to `models-catalog.ts` (models.dev fetcher)
- Changes to `KnownModel` type or `ListModelsOptions` type
- CLI-based discovery for Claude Code or Codex
- New public API functions

## User Stories

- **As a spawner consumer**, I can call `listModels({ cli: 'opencode' })` and get models from the OpenCode CLI, while `listModels({ cli: 'claude' })` still uses models.dev.
- **As a spawner consumer**, I can call `listModels({ cli: 'opencode', provider: 'anthropic' })` and get only Anthropic models from the OpenCode CLI output.
- **As a spawner consumer**, I can call `refreshModels()` and it refreshes both the models.dev cache and the OpenCode CLI cache.

## Business Rules

1. When `cli='opencode'` and no `provider` override: use `ensureCliModelsCache()` from spec 12, return all models.
2. When `cli='opencode'` and `provider` is set: use `ensureCliModelsCache()`, then filter `model.provider === provider`.
3. When `cli='opencode'`: the `fallback` option is silently ignored. If the CLI fails, the error propagates.
4. When `cli='claude'` or `cli='codex'`: existing behavior unchanged (models.dev via `ensureCache()`).
5. When no `cli` and no `provider`: existing behavior (all models from models.dev). OpenCode CLI models are NOT mixed in.
6. `provider` without `cli` continues to filter models.dev (existing behavior).
7. Results are always sorted alphabetically by `id`.
8. `CLI_PROVIDER_MAP` is narrowed to `Record<'claude' | 'codex', string>` — remove `opencode: null` since the OpenCode path branches before the map is consulted.
9. `refreshModels()` refreshes both caches in parallel via `Promise.allSettled`. It only throws if ALL refreshes fail.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `listModels({ cli: 'opencode', fallback: [...] })` | `fallback` is ignored; CLI error propagates |
| `listModels({ cli: 'opencode', provider: 'nonexistent' })` | Returns empty `KnownModel[]` |
| `listModels()` (no options) | Returns all models.dev models (existing behavior, no OpenCode CLI involvement) |
| `listModels({ provider: 'anthropic' })` | Returns Anthropic models from models.dev (existing behavior) |
| `getKnownModels('opencode')` | Delegates to `listModels({ cli: 'opencode' })` — uses CLI |
| `refreshModels()` | Refreshes both models.dev and OpenCode CLI caches (`Promise.allSettled` — one failure doesn't block the other) |

## API / Interface

No new public functions. The existing API surface stays the same:

```typescript
// src/models.ts — unchanged signatures

export async function listModels(options?: ListModelsOptions): Promise<KnownModel[]>;
export async function getKnownModels(cli?: CliName, fallbackModels?: KnownModel[]): Promise<KnownModel[]>;
export async function refreshModels(): Promise<void>;
```

### Updated `listModels` flow

```
listModels(options)
  │
  ├─ options.cli === 'opencode' ?
  │    ├─ cache = await ensureCliModelsCache()
  │    ├─ models = cache.data
  │    ├─ if options.provider → filter by model.provider
  │    ├─ sort by id
  │    └─ return models
  │
  └─ else (claude, codex, or no cli)
       └─ existing models.dev flow (unchanged)
```

## Architecture

- **Modified file:** `src/models.ts`
- **New imports:** `ensureCliModelsCache`, `refreshCliModelsCache` from `src/core/cli-models.ts`
- **No changes to:** `src/types.ts`, `src/core/models-catalog.ts`, `src/index.ts`
- **`CLI_PROVIDER_MAP`:** Remove the `opencode: null` entry since the OpenCode path branches before the map is consulted. The map only needs `claude` and `codex`.
- **`CliModelsFetchError`:** NOT exported from `src/index.ts` (follows same pattern as `ModelsFetchError` — internal, importable in tests directly)

### Module dependency

```
src/models.ts
  ├── src/core/models-catalog.ts  (existing — claude, codex)
  └── src/core/cli-models.ts      (new — opencode, spec 12)
```

### Updated refreshModels

```typescript
export async function refreshModels(): Promise<void> {
  // Refresh both caches in parallel — one failure doesn't block the other
  const results = await Promise.allSettled([
    refreshCache(),
    refreshCliModelsCache(),
  ]);

  // If both failed, throw the first error
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length === results.length) {
    throw failures[0].reason;
  }
}
```

## Acceptance Criteria

- Given `cli='opencode'`, when `listModels` is called, then `ensureCliModelsCache()` is used (not `ensureCache()`).
- Given `cli='opencode'` and `provider='anthropic'`, when `listModels` is called, then only models with `provider === 'anthropic'` from the CLI output are returned.
- Given `cli='opencode'` and `fallback` is provided, when the CLI command fails, then the error propagates and `fallback` is not used.
- Given `cli='claude'`, when `listModels` is called, then models.dev is used (existing behavior unchanged).
- Given no options, when `listModels` is called, then models.dev is used (existing behavior unchanged).
- Given `cli='opencode'`, when `listModels` returns, then results are sorted alphabetically by `id`.
- Given `getKnownModels('opencode')` is called, then it delegates to `listModels({ cli: 'opencode' })`.
- Given `refreshModels()` is called, then both models.dev and OpenCode CLI caches are refreshed.
- Given `refreshModels()` is called and OpenCode CLI refresh fails but models.dev succeeds, then `refreshModels()` resolves (does not throw).
- Given `refreshModels()` is called and both refreshes fail, then `refreshModels()` throws.

## Testing Strategy

**Test file:** `src/models.test.ts` (extend existing)

**Mocking pattern:** Mock both `ensureCache`/`refreshCache` (models.dev) and `ensureCliModelsCache`/`refreshCliModelsCache` (CLI) to verify correct routing. Use `vi.mock()` for module-level mocking.

**Test cases:**
- `listModels({ cli: 'opencode' })` routes to `ensureCliModelsCache` (not `ensureCache`)
- Provider filtering on CLI-sourced models
- Fallback is ignored for OpenCode (error propagates)
- Sort order on CLI-sourced models
- `cli='claude'` and `cli='codex'` behavior unchanged
- `listModels()` with no options uses models.dev (not CLI)
- `listModels({ provider: 'anthropic' })` uses models.dev
- `getKnownModels('opencode')` delegation
- `refreshModels()` refreshes both caches
- `refreshModels()` succeeds if only one cache refresh fails
- `refreshModels()` throws if both fail
- `CLI_PROVIDER_MAP` no longer has `opencode` key
