---
title: Spawner - Implementation Specifications
created: 2026-03-16
updated: 2026-03-24
tags: [spawner, specs, typescript]
---

# Specifications

## Tech Stack
- **Language:** TypeScript
- **Runtime:** Node 18+ (ESM + CJS dual-publish)
- **Dependencies:** Zero runtime deps (Node builtins only)
- **Dev Dependencies:** typescript, vitest
- **Testing:** Fixture replay + mocked child_process

## Module Structure

```
src/
  core/         # spawn, detect, stream, extract, errors, debug
  adapters/     # claude, codex, opencode + adapter interface
  types.ts      # All public types
  models.ts     # Dynamic models API (fetches from models.dev)
  core/models-catalog.ts  # models.dev fetcher + cache
  index.ts      # Public re-exports
```

## Specs

| Spec | Source Path | Description |
|------|------------|-------------|
| [Types & Constants](./archive/01-types-and-constants.md) | `src/types.ts`, `src/adapters/index.ts` | Shared types, interfaces, enums, adapter registry. **Note:** model-related types (`KnownModel`, `ListModelsOptions`, `KNOWN_MODELS`) are superseded by specs 09-11. |
| [Detection](./02-detection.md) | `src/core/detect.ts` | Detect CLI installation, version, and auth status |
| [Command Building](./03-command-building.md) | `src/adapters/{claude,codex,opencode}.ts` | Build CLI command + args from SpawnOptions |
| [Stream Parsing](./04-stream-parsing.md) | `src/core/stream.ts`, `src/adapters/*.ts` | Parse raw JSONL into normalized CliEvent stream |
| [Spawn & Process](./05-spawn-and-process.md) | `src/core/spawn.ts` | Spawn CLI process, wire streaming, manage lifecycle |
| [Error Classification](./06-error-classification.md) | `src/core/errors.ts`, `src/adapters/*.ts` | Classify CLI errors into typed CliError objects |
| [Extract](./07-extract.md) | `src/core/extract.ts` | Post-hoc extraction of CliResult from saved output |
| [Testing Strategy](./08-testing-strategy.md) | `test/`, `scripts/` | Test architecture, fixtures, mocking, and e2e script |
| [Models Catalog Fetcher](./09-models-catalog-fetcher.md) | `src/core/models-catalog.ts` | Fetch, parse, and cache models.dev catalog with 24h TTL, stale cache fallback, ModelsFetchError |
| [Model Types & Mapping](./10-model-types-and-mapping.md) | `src/types.ts`, `src/models.ts` | Updated KnownModel interface (drop `cli`, widen `provider`), CLI→provider mapping, OpenCode ID format |
| [Models Public API](./11-models-public-api.md) | `src/models.ts`, `src/index.ts` | Async `listModels()`, `getKnownModels()`, `refreshModels()` with `fallback` and stale cache support |
