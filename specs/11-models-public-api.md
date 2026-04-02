---
title: Models Public API
created: 2026-03-24
topic: 3 of 3 — Dynamic Model Listing
---

# Models Public API

## Overview

Replace the existing sync `listModels()` and `getKnownModels()` functions with async versions powered by the models catalog fetcher (spec 09). Add `refreshModels()` for cache control. Remove the static `KNOWN_MODELS` export.

## Why It Exists

The current public API exposes a static list of 7 hardcoded models. This spec defines the new async API that fetches from models.dev dynamically, filters by CLI/provider, and gives consumers control over fallback behavior and cache refresh.

## Scope

**In scope:**
- Async `listModels(options?)` — replaces current sync version
- Async `getKnownModels(cli?)` — replaces current sync version
- `refreshModels()` — force-refresh the cache
- Remove `KNOWN_MODELS` export
- Update `src/index.ts` exports

**Out of scope:**
- The fetcher/cache internals (spec 09)
- Type definitions (spec 10)

## Public API / Interface

### `listModels(options?: ListModelsOptions): Promise<KnownModel[]>`

Primary function for model discovery. Fetches from models.dev (with caching) and filters results.

```typescript
async function listModels(options?: ListModelsOptions): Promise<KnownModel[]>;
```

**Behavior:**
1. Call `ensureCache()` to get the cached catalog (fetches if needed; may return stale cache on failure)
2. If `ensureCache()` throws (no cache at all) and `options.fallback` is provided, return `options.fallback`
3. If `ensureCache()` throws and no fallback, throw the `ModelsFetchError`
4. Apply filters:
   - If `options.provider` is set → filter to that provider
   - Else if `options.cli` is set → map via `CLI_PROVIDER_MAP` and filter
   - If neither → return all models from all providers
5. Return flattened `KnownModel[]` sorted alphabetically by `id`

**Examples:**
```typescript
// All models from all providers
const all = await listModels();

// Claude Code models (anthropic provider)
const claude = await listModels({ cli: 'claude' });

// Codex models (openai provider)
const codex = await listModels({ cli: 'codex' });

// OpenCode models (all providers)
const opencode = await listModels({ cli: 'opencode' });

// Direct provider filter
const google = await listModels({ provider: 'google' });

// With fallback on failure
const models = await listModels({
  cli: 'claude',
  fallback: [{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200_000, supportsEffort: true }],
});
```

### `getKnownModels(cli?: CliName, fallbackModels?: KnownModel[]): Promise<KnownModel[]>`

Convenience wrapper. Equivalent to `listModels({ cli, fallback: fallbackModels })`. Kept for backward compatibility with simpler call sites.

```typescript
async function getKnownModels(cli?: CliName, fallbackModels?: KnownModel[]): Promise<KnownModel[]>;
```

### `refreshModels(): Promise<void>`

Force-refresh the in-memory cache by fetching from models.dev and replacing the cache atomically.

```typescript
async function refreshModels(): Promise<void>;
```

**Behavior:**
1. Call `invalidateAndFetch()` (spec 09) which fetches first, then replaces the cache on success
2. If fetch fails, throw the error — **cache is preserved** (not cleared). This avoids a destructive failure mode where a failed refresh leaves consumers with no data.

## Architecture

```
src/models.ts (REWRITTEN)
  ├── listModels()        — public, async
  ├── getKnownModels()    — public, async
  └── refreshModels()     — public, async

  Depends on:
  └── src/core/models-catalog.ts (spec 09)
       ├── ensureCache()
       └── invalidateAndFetch()

src/index.ts (UPDATED)
  - Remove: export { KNOWN_MODELS }
  - Keep:   export { listModels, getKnownModels }
  - Add:    export { refreshModels }
```

### File Changes

| File | Action | Details |
|---|---|---|
| `src/types.ts` | Edit | Update `KnownModel` (drop `cli`, widen `provider`), update `ListModelsOptions` (add `fallback`) |
| `src/core/models-catalog.ts` | Create | Fetcher, cache, transform logic |
| `src/models.ts` | Rewrite | Remove `KNOWN_MODELS`, rewrite `listModels`/`getKnownModels` as async, add `refreshModels` |
| `src/index.ts` | Edit | Remove `KNOWN_MODELS` export, add `refreshModels` export |
| `src/models.test.ts` | Rewrite | All tests become async, mock `global.fetch` |
| `README.md` | Edit | Update models usage examples to async API, remove `KNOWN_MODELS` references |

## Business Rules

1. **Sort order.** `listModels()` returns results sorted alphabetically by `id` using locale-independent string comparison (`a.id.localeCompare(b.id, 'en')`) for deterministic output across environments.
2. **Filter precedence.** `provider` takes precedence over `cli` when both are specified. This is a behavioral change from the current API where both filters stack (see spec 10 Breaking Changes).
3. **OpenCode = all.** `cli: 'opencode'` applies no provider filter — all 100+ providers are returned.
4. **Fallback behavior.** The `fallback` parameter is ONLY used when the fetch fails AND no stale cache is available. If the fetch fails but a stale cache exists, the stale cache data is used (not the fallback). If fetch succeeds but returns zero matching models, an empty array is returned (not the fallback).
5. **No static export.** `KNOWN_MODELS` is removed entirely. There is no sync way to get models.
6. **Debug logging.** All public API functions log via the existing debug logger: filter applied, result count, cache hit/miss/stale.

## Edge Cases

- **First call with no network and no stale cache:** If `fallback` provided, returns `fallback`. Otherwise throws `ModelsFetchError`.
- **First call with no network but stale cache exists:** Returns stale cache data (stale cache > fallback > error).
- **`listModels({ cli: 'opencode' })` returns thousands of models:** This is expected. OpenCode supports all providers. Consumers should further filter by `provider` if they need a smaller set.
- **Unknown provider string:** `listModels({ provider: 'nonexistent' })` returns `[]`.
- **`getKnownModels()` with no argument:** Returns all models from all providers (same as `listModels()`).
- **`getKnownModels('claude', fallback)` with network failure:** Uses stale cache if available, otherwise returns `fallback`.
- **`refreshModels()` fails:** Cache is **preserved** (not cleared). The error is thrown. Consumers continue to get cached data from `listModels()`.
- **Consumer passes both `cli` and `provider`:** `provider` wins. No warning.

## Acceptance Criteria

- **Given** network is available, **when** `listModels()` is called, **then** it returns models from all providers, sorted by `id`.
- **Given** network is available, **when** `listModels({ cli: 'claude' })` is called, **then** only `provider === 'anthropic'` models are returned.
- **Given** network is available, **when** `listModels({ cli: 'codex' })` is called, **then** only `provider === 'openai'` models are returned.
- **Given** network is available, **when** `listModels({ cli: 'opencode' })` is called, **then** models from all providers are returned.
- **Given** network is available, **when** `listModels({ provider: 'google' })` is called, **then** only Google provider models are returned.
- **Given** network is down and no cache exists, **when** `listModels({ fallback })` is called, **then** `fallback` is returned.
- **Given** network is down and no cache exists, **when** `listModels()` is called (no fallback), **then** it throws `ModelsFetchError`.
- **Given** network is down and expired cache exists, **when** `listModels()` is called, **then** stale cache data is returned (not fallback, not error).
- **Given** cache is populated, **when** `refreshModels()` is called successfully, **then** cache is replaced with fresh data.
- **Given** cache is populated, **when** `refreshModels()` fails, **then** cache is preserved and error is thrown.
- **Given** cache is populated, **when** `listModels()` is called, **then** no HTTP request is made (cache hit).
- **Given** `listModels({ provider: 'nonexistent' })`, **when** called, **then** returns `[]`.
- **Given** `listModels({ cli: 'claude', provider: 'openai' })`, **when** called, **then** returns OpenAI models (provider wins).
- **Given** network is down, **when** `getKnownModels('claude', fallback)` is called, **then** `fallback` is returned.
- **Given** network is available, **when** `getKnownModels('claude')` is called, **then** it returns only `provider === 'anthropic'` models (same as `listModels({ cli: 'claude' })`).

## Migration Guide

Consumers upgrading from the sync API:

```typescript
// BEFORE
import { KNOWN_MODELS, getKnownModels, listModels } from '@0xtiby/spawner';

const all = KNOWN_MODELS;
const claude = getKnownModels('claude');
const openai = listModels({ provider: 'openai' });
const hasCli = model.cli.includes('claude');

// AFTER
import { getKnownModels, listModels } from '@0xtiby/spawner';

const all = await listModels();
const claude = await getKnownModels('claude');
const openai = await listModels({ provider: 'openai' });
// cli field removed — filter by provider instead
const isAnthropic = model.provider === 'anthropic';

// With offline fallback
const models = await listModels({
  cli: 'claude',
  fallback: [{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200_000, supportsEffort: true }],
});
```

## Testing Strategy

- **Mock `global.fetch`** in all tests to avoid real network calls.
- **Fixture file:** Use `test/fixtures/models-dev-sample.json` with a minimal but realistic response (3 anthropic models, 3 openai models, 2 google models).
- **Test categories:**
  - Filter by `cli` (all three CLIs)
  - Filter by `provider`
  - Filter precedence (`cli` + `provider`)
  - Fallback on failure (no stale cache)
  - Stale cache preferred over fallback
  - Error propagation (no fallback, no stale cache)
  - Cache behavior (hit, miss, refresh success, refresh failure preserves cache)
  - Sort order verification (locale-independent)
  - Empty results for unknown provider
  - Debug log output (verify cache hit/miss/stale messages)
