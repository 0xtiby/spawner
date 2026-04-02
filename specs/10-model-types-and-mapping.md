---
title: Model Types and Mapping
created: 2026-03-24
topic: 2 of 3 — Dynamic Model Listing
---

# Model Types and Mapping

## Overview

Update the `KnownModel` interface and `ListModelsOptions` to support dynamic model discovery. Drop the `cli` field from `KnownModel`, widen `provider` to `string`, and define the CLI-to-provider mapping used for filtering.

## Why It Exists

The current `KnownModel` has a `cli: CliName[]` field and a narrow `provider: 'anthropic' | 'openai' | 'other'` union. With 100+ providers from models.dev and the understanding that CLI compatibility is really about provider support (not a per-model property), these fields need to change.

## Scope

**In scope:**
- Updated `KnownModel` interface in `src/types.ts`
- Updated `ListModelsOptions` interface in `src/types.ts`
- CLI → provider mapping constant (defined in `src/models.ts`, used by `listModels()`)

**Out of scope:**
- The fetch/cache mechanism (spec 09)
- The public API functions and removal of `KNOWN_MODELS` (spec 11)

## Data Model

### KnownModel (updated)

```typescript
// BEFORE
interface KnownModel {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'other';
  cli: CliName[];
  contextWindow: number | null;
  supportsEffort: boolean;
}

// AFTER
interface KnownModel {
  id: string;
  name: string;
  provider: string;            // models.dev provider ID: 'anthropic', 'openai', 'google', 'mistral', etc.
  contextWindow: number | null;
  supportsEffort: boolean;
}
```

**Changes:**
- `provider` widened from union to `string` — matches models.dev provider IDs exactly
- `cli` field removed — CLI compatibility is derived from the provider via mapping

### ListModelsOptions (updated)

```typescript
// BEFORE
interface ListModelsOptions {
  cli?: CliName;
  provider?: string;
}

// AFTER
interface ListModelsOptions {
  cli?: CliName;              // convenience filter: maps to provider internally
  provider?: string;          // direct provider filter
  fallback?: KnownModel[];   // returned on fetch failure (when no cache available)
}
```

**Changes:**
- Added `fallback` field for consumer-provided fallback on network failure (named `fallback` instead of `default` to avoid collision with the JS reserved keyword)
- `cli` is kept as a convenience filter (maps internally via CLI_PROVIDER_MAP)
- When both `cli` and `provider` are specified, `provider` takes precedence

### CLI → Provider Mapping

```typescript
// Defined in src/models.ts — internal constant, not exported from public API

const CLI_PROVIDER_MAP: Record<CliName, string | null> = {
  claude: 'anthropic',
  codex: 'openai',
  opencode: null,  // null = all providers (no filter)
};
```

**Mapping rules:**
- `cli: 'claude'` → filter to `provider === 'anthropic'`
- `cli: 'codex'` → filter to `provider === 'openai'`
- `cli: 'opencode'` → no provider filter (return all models from all providers)
- `cli` + `provider` both set → `provider` wins

> **Note:** This mapping replaces the current approach where `listModels()` filters via `model.cli.includes(cli)`. The new approach derives CLI compatibility from the provider, rather than storing it per-model.

### OpenCode Model ID Format

OpenCode uses namespaced model IDs (`provider/model-id`, e.g. `anthropic/claude-sonnet-4-20250514`) while models.dev uses flat IDs (`claude-sonnet-4-20250514`). The models catalog returns models with flat IDs from models.dev — it does **not** prefix them with the provider namespace.

OpenCode consumers who need the namespaced format can construct it from `KnownModel.provider` and `KnownModel.id`:

```typescript
const openCodeId = `${model.provider}/${model.id}`;
```

This is a consumer concern, not part of the `KnownModel` type itself.

## Implementation Order

Specs 09, 10, and 11 **must be implemented atomically** in a single PR. Changing `KnownModel` (dropping `cli`, widening `provider`) will break the existing `KNOWN_MODELS` array and the `getKnownModels()` filter logic. The three specs are logically ordered (types → fetcher → API) but all three changes land together.

**Suggested implementation sequence within the PR:**
1. Update `KnownModel` and `ListModelsOptions` in `src/types.ts` (spec 10)
2. Create `src/core/models-catalog.ts` (spec 09)
3. Rewrite `src/models.ts` (spec 11)
4. Update `src/index.ts` exports (spec 11)
5. Update tests

## Breaking Changes

This is a **breaking change** to the public API and requires a **semver major version bump** (or a minor bump while on 0.x per semver conventions):

1. **`KnownModel.cli` removed** — consumers referencing `model.cli` will get type errors
2. **`KnownModel.provider` widened** — code checking `provider === 'other'` will need updating
3. **`KNOWN_MODELS` export removed** — consumers importing the static array need to switch to async `listModels()`
4. **`listModels()` becomes async** — all call sites need `await`
5. **`getKnownModels()` becomes async** — all call sites need `await`
6. **Filter precedence changed** — the current `listModels()` applies `cli` first then `provider` (both filters stack). The new version treats `provider` and `cli` as alternatives where `provider` takes precedence if both are set. This is a behavioral change for consumers passing both options.

## Acceptance Criteria

- **Given** the updated `KnownModel` interface, **when** a consumer accesses a model, **then** it has `id`, `name`, `provider` (string), `contextWindow`, and `supportsEffort` — no `cli` field.
- **Given** `listModels({ cli: 'claude' })`, **when** the mapping is applied, **then** only models with `provider === 'anthropic'` are returned.
- **Given** `listModels({ cli: 'codex' })`, **when** the mapping is applied, **then** only models with `provider === 'openai'` are returned.
- **Given** `listModels({ cli: 'opencode' })`, **when** the mapping is applied, **then** models from ALL providers are returned.
- **Given** `listModels({ cli: 'claude', provider: 'openai' })`, **when** both are set, **then** `provider` wins and only OpenAI models are returned.
- **Given** `listModels({ provider: 'google' })`, **when** no cli is set, **then** only Google provider models are returned.

## Testing Strategy

- **Type tests:** Verify `KnownModel` shape at compile time (TypeScript `satisfies` checks). Verify `cli` field is absent.
- **Mapping tests:** Assert `CLI_PROVIDER_MAP` entries and the precedence logic (provider wins over cli).
- **OpenCode ID format test:** Verify `${model.provider}/${model.id}` produces expected namespaced IDs.
- **Integration with fetcher:** Covered in spec 11 tests.
