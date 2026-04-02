---
title: Models Catalog Fetcher
created: 2026-03-24
topic: 1 of 3 — Dynamic Model Listing
---

# Models Catalog Fetcher

## Overview

Fetch, parse, and cache the models.dev catalog (`https://models.dev/api.json`) to provide dynamic model discovery for all supported CLIs. Replaces the current static `KNOWN_MODELS` array with a live catalog that refreshes every 24 hours.

## Why It Exists

The current `KNOWN_MODELS` in `src/models.ts` is a hardcoded list of 7 models that goes stale as providers release new models. This fetcher provides a single, universal source of truth that covers Anthropic, OpenAI, and 100+ other providers used by OpenCode.

## Scope

**In scope:**
- Fetch `models.dev/api.json` via Node 18+ built-in `fetch()`
- Parse the response into a provider-keyed `Map<string, KnownModel[]>`
- In-memory TTL-based cache (24-hour expiry)
- Transform models.dev raw model objects into `KnownModel` shape
- Graceful failure: if fetch fails and stale cache exists, return stale data. If no cache exists, let the consumer-provided `fallback` take over (handled in the public API layer — spec 11)

**Out of scope:**
- Filesystem caching (in-memory only)
- Auth/usability checks (just list what's available)
- Custom cache adapters

## Data Source

**URL:** `https://models.dev/api.json`

**Response structure:**
```json
{
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "models": {
      "claude-sonnet-4-20250514": {
        "id": "claude-sonnet-4-20250514",
        "name": "Claude Sonnet 4",
        "reasoning": true,
        "limit": { "context": 200000, "output": 64000 },
        ...
      }
    }
  },
  "openai": { ... },
  ...
}
```

Each provider entry has an `id`, `name`, and `models` dict keyed by model ID.

**Relevant model fields for mapping:**

| models.dev field | Used for |
|---|---|
| `model.id` | `KnownModel.id` |
| `model.name` | `KnownModel.name` |
| provider key | `KnownModel.provider` |
| `model.limit.context` | `KnownModel.contextWindow` |
| `model.reasoning` | `KnownModel.supportsEffort` |

All other fields (cost, modalities, release_date, etc.) are ignored.

## Business Rules

1. **Cache TTL is 24 hours.** After 24h, the next `listModels()` call triggers a fresh fetch.
2. **Single in-flight fetch.** If multiple callers request models simultaneously while cache is empty/expired, only one fetch executes. Others await the same promise.
3. **Fetch timeout.** The fetch call uses `AbortSignal.timeout(10_000)` to abort after 10 seconds. Node 18+ `fetch` does not have a native timeout option — `AbortSignal.timeout()` is the idiomatic approach.
4. **Cache stores transformed data.** The raw api.json response is NOT cached — only the transformed `Map<string, KnownModel[]>` is stored in memory.
5. **models.dev provides 100+ providers and 3800+ models.** All are cached in memory after transformation. Typical memory footprint is ~100-200 KB.
6. **Stale cache on failure.** If the cache is expired and a fresh fetch fails, the stale cache is returned instead of throwing. This prevents cascading failures when models.dev is temporarily unreachable. The returned `ModelsCache` has `stale: true` so consumers can detect this.
7. **Response size limit.** The fetch aborts if the response body exceeds 10 MB to guard against corrupted or unexpectedly large responses.
8. **HTTP error handling.** Non-2xx responses (including 429 rate limits) are treated as fetch failures. The error message includes the HTTP status code and status text for diagnostics.

## Data Model

```typescript
// Internal — not exported

interface ModelsDevRawModel {
  id: string;
  name: string;
  reasoning?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
}

interface ModelsDevRawProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevRawModel>;
}

type ModelsDevRawResponse = Record<string, ModelsDevRawProvider>;

interface ModelsCache {
  data: Map<string, KnownModel[]>; // keyed by provider ID
  fetchedAt: number;                // Date.now() timestamp
  stale: boolean;                   // true if returned from expired cache after fetch failure
}

// Typed error for fetch failures — distinct from CliError
class ModelsFetchError extends Error {
  readonly statusCode?: number;     // HTTP status if applicable (e.g. 429, 500)
  readonly cause?: Error;           // underlying fetch/parse error
  constructor(message: string, options?: { statusCode?: number; cause?: Error });
}
```

## Architecture

```
src/core/models-catalog.ts   (NEW)
  ├── ensureCache(): Promise<ModelsCache>
  ├── fetchCatalog(): Promise<ModelsDevRawResponse>
  ├── transformCatalog(raw: ModelsDevRawResponse): Map<string, KnownModel[]>
  ├── toKnownModel(providerId: string, raw: ModelsDevRawModel): KnownModel
  ├── getCache(): ModelsCache | null
  ├── clearCache(): void
  └── invalidateAndFetch(): Promise<ModelsCache>  // used by refreshModels()
```

### Debug Logging

All operations emit debug logs via the existing `src/core/debug.ts` logger (NODE_DEBUG=spawner):

- `ensureCache()` — logs cache hit, cache miss, stale-cache-returned-on-failure
- `fetchCatalog()` — logs fetch start, HTTP status, response size, fetch duration
- `transformCatalog()` — logs provider count and total model count

### Function Signatures

```typescript
// Ensure cache is populated and fresh. Returns existing cache if within TTL.
// If cache is expired or empty, fetches from models.dev.
async function ensureCache(): Promise<ModelsCache>;

// Raw fetch from models.dev/api.json with AbortSignal.timeout().
async function fetchCatalog(): Promise<ModelsDevRawResponse>;

// Transform the full raw response into provider-keyed KnownModel arrays.
function transformCatalog(raw: ModelsDevRawResponse): Map<string, KnownModel[]>;

// Transform a single models.dev model into KnownModel.
function toKnownModel(providerId: string, raw: ModelsDevRawModel): KnownModel;

// Expose cache for refresh/clear operations.
function getCache(): ModelsCache | null;
function clearCache(): void;

// Atomic clear-and-refetch used by refreshModels().
// Fetches first, then replaces cache on success. If fetch fails, cache is NOT cleared.
// Throws ModelsFetchError on failure (no stale fallback — refresh is explicit).
async function invalidateAndFetch(): Promise<ModelsCache>;
```

### Module-level State

```typescript
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODELS_DEV_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 10_000;

let cache: ModelsCache | null = null;
let inflight: Promise<ModelsCache> | null = null; // dedup concurrent fetches
```

## Edge Cases

- **models.dev returns invalid JSON:** Throw `ModelsFetchError`. If stale cache exists, return it with `stale: true`.
- **models.dev returns valid JSON but unexpected shape:** Validate that `models` dict exists per provider. Skip malformed entries silently.
- **models.dev returns non-2xx (e.g. 429, 500):** Throw `ModelsFetchError` with `statusCode`. Stale cache fallback applies.
- **Response body exceeds 10 MB:** Abort fetch, throw `ModelsFetchError`. Stale cache fallback applies.
- **Model missing `limit` or `reasoning` field:** Default `contextWindow` to `null`, `supportsEffort` to `false`.
- **Empty provider (no models):** Include the provider key with an empty array.
- **Concurrent fetch deduplication:** If `ensureCache()` is called while a fetch is in-flight, return the same promise.
- **Inflight promise cleanup on failure:** If the fetch rejects, `inflight` must be set to `null` so the next `ensureCache()` call retries instead of returning the cached rejected promise.
- **Race between `invalidateAndFetch()` and inflight `ensureCache()`:** `invalidateAndFetch()` does NOT use the shared `inflight` promise. It performs its own independent fetch. On success, it replaces the cache atomically. Any concurrent `ensureCache()` inflight promise will resolve and update the cache independently — last-write-wins is acceptable since both fetch the same upstream data.

## Acceptance Criteria

- **Given** the cache is empty, **when** `ensureCache()` is called, **then** it fetches from models.dev and populates the cache.
- **Given** the cache is populated and within TTL, **when** `ensureCache()` is called, **then** it returns the cached data without fetching.
- **Given** the cache is older than 24 hours, **when** `ensureCache()` is called, **then** it re-fetches from models.dev.
- **Given** two concurrent calls to `ensureCache()` with empty cache, **when** both execute, **then** only one HTTP request is made.
- **Given** models.dev is unreachable, **when** `ensureCache()` is called with no existing cache, **then** it throws `ModelsFetchError`.
- **Given** models.dev is unreachable, **when** `ensureCache()` is called with an expired cache, **then** it returns the stale cache with `stale: true`.
- **Given** models.dev returns a non-2xx status, **when** `ensureCache()` is called, **then** it throws `ModelsFetchError` with `statusCode` set (stale fallback still applies).
- **Given** the response body exceeds 10 MB, **when** `fetchCatalog()` is called, **then** it aborts and throws `ModelsFetchError`.
- **Given** `clearCache()` is called, **when** `ensureCache()` is called next, **then** it re-fetches regardless of previous TTL.
- **Given** the in-flight fetch rejects, **when** `ensureCache()` is called again, **then** it retries the fetch (inflight promise is cleared on failure).
- **Given** a models.dev model has no `limit` field, **when** transformed, **then** `contextWindow` is `null`.
- **Given** a models.dev model has no `reasoning` field, **when** transformed, **then** `supportsEffort` is `false`.

## Testing Strategy

- **Unit tests for `toKnownModel`:** Feed raw model objects, assert KnownModel output.
- **Unit tests for `transformCatalog`:** Feed a minimal raw response with 2-3 providers, assert Map structure.
- **Unit tests for `ensureCache`:** Mock `global.fetch` to control responses and timing. Test TTL expiry, concurrent dedup, failure paths, and stale cache fallback.
- **Unit tests for `invalidateAndFetch`:** Verify fetch-then-replace atomicity — cache preserved on failure, replaced on success.
- **Unit tests for `ModelsFetchError`:** Verify `statusCode` and `cause` propagation for HTTP errors, JSON parse errors, and timeout.
- **Stale cache tests:** Verify expired cache returned with `stale: true` when fetch fails; verify `stale: false` on fresh fetch.
- **Fixture:** Create a minimal `test/fixtures/models-dev-sample.json` with a handful of models from anthropic/openai for deterministic testing.
