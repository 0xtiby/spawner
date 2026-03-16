---
title: "Spec: Types & Constants"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, types]
---

# Types & Constants

## Overview

All shared type definitions, interfaces, enums, and the static known-models registry. These are the public contracts that every other module depends on. Defined in `src/types.ts` and `src/models.ts`.

## Scope

**In:** Public types exported by the package, internal adapter interface, session accumulator, known-models registry.

**Out:** Implementation logic, private helpers, per-adapter parsing details.

---

## Public Types

### CliName

```typescript
type CliName = 'claude' | 'codex' | 'opencode';
```

### SpawnOptions

```typescript
interface SpawnOptions {
  cli: CliName;
  prompt: string;
  cwd: string;
  model?: string;
  sessionId?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  autoApprove?: boolean;
  forkSession?: boolean;
  continueSession?: boolean;
  addDirs?: string[];
  ephemeral?: boolean;
  verbose?: boolean;
  abortSignal?: AbortSignal;
  extraArgs?: string[];
}
```

### CliProcess

```typescript
interface CliProcess {
  events: AsyncIterable<CliEvent>;
  pid: number;
  interrupt(graceMs?: number): Promise<CliResult>;
  done: Promise<CliResult>;
}
```

### CliEvent

```typescript
type CliEventType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'system'
  | 'done';

interface CliEvent {
  type: CliEventType;
  timestamp: number;
  content?: string;
  tool?: {
    name: string;
    input?: Record<string, unknown>;
  };
  toolResult?: {
    name: string;
    output?: string;
    error?: string;
  };
  result?: CliResult;
  raw: string;
}
```

### CliResult

```typescript
interface CliResult {
  exitCode: number;
  sessionId: string | null;
  usage: TokenUsage | null;
  model: string | null;
  error: CliError | null;
  durationMs: number;
}
```

### TokenUsage

```typescript
interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
}
```

### CliError

```typescript
type CliErrorCode =
  | 'rate_limit'
  | 'auth'
  | 'session_not_found'
  | 'model_not_found'
  | 'context_overflow'
  | 'permission_denied'
  | 'binary_not_found'
  | 'fatal'
  | 'unknown';

interface CliError {
  code: CliErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs: number | null;
  raw: string;
}
```

### DetectResult

```typescript
interface DetectResult {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  binaryPath: string | null;
}
```

### Extract & Model Types

```typescript
interface ExtractOptions {
  cli: CliName;
  rawOutput: string;
}

interface ListModelsOptions {
  cli: CliName;
  provider?: string;
  refresh?: boolean;
}

interface KnownModel {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'other';
  cli: CliName[];
  contextWindow: number | null;
  supportsEffort: boolean;
}
```

---

## Internal Types

### CliAdapter (src/adapters/types.ts)

```typescript
interface CliAdapter {
  name: CliName;
  buildCommand(options: SpawnOptions): { bin: string; args: string[]; stdinInput?: string };
  parseLine(line: string, accumulator: SessionAccumulator): CliEvent[];
  detect(): Promise<DetectResult>;
  classifyError(exitCode: number, stderr: string, stdout: string): CliError;
}
```

### SessionAccumulator (src/adapters/types.ts)

Mutable state tracked across stream lines. Each adapter writes to it; core reads it for `CliResult`.

```typescript
interface SessionAccumulator {
  sessionId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}
```

Factory function to create a fresh accumulator:

```typescript
function createAccumulator(): SessionAccumulator {
  return { sessionId: null, model: null, inputTokens: 0, outputTokens: 0, cost: null };
}
```

---

## Known Models Registry (src/models.ts)

Static list of top models per CLI. Informational only — never consulted during `spawn()`.

```typescript
const KNOWN_MODELS: KnownModel[] = [
  // Claude Code
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    cli: ['claude'],
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    cli: ['claude'],
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    cli: ['claude'],
    contextWindow: 200_000,
    supportsEffort: false,
  },
  // Codex
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'openai',
    cli: ['codex'],
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    cli: ['codex'],
    contextWindow: 128_000,
    supportsEffort: false,
  },
  // OpenCode
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4 (OpenCode)',
    provider: 'anthropic',
    cli: ['opencode'],
    contextWindow: 200_000,
    supportsEffort: false,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1 (OpenCode)',
    provider: 'openai',
    cli: ['opencode'],
    contextWindow: 128_000,
    supportsEffort: false,
  },
];

function getKnownModels(cli?: CliName): KnownModel[] {
  if (!cli) return KNOWN_MODELS;
  return KNOWN_MODELS.filter(m => m.cli.includes(cli));
}
```

---

## Package Exports (src/index.ts)

```typescript
// Main API
export { detect, detectAll } from './core/detect';
export { spawn } from './core/spawn';
export { extract } from './core/extract';
export { classifyError } from './core/errors';
export { listModels } from './core/models';

// Types
export type {
  CliName, CliEvent, CliEventType, CliResult, CliError, CliErrorCode,
  CliProcess, SpawnOptions, DetectResult, TokenUsage, ExtractOptions,
  KnownModel, ListModelsOptions,
} from './types';

// Registry
export { KNOWN_MODELS, getKnownModels } from './models';
```

---

## Acceptance Criteria

- Given a consumer imports from `spawner`, when they access any public type, then it is available and correctly typed
- Given `getKnownModels('claude')` is called, then only models with `cli` including `'claude'` are returned
- Given `getKnownModels()` is called with no argument, then all models are returned
- Given `createAccumulator()` is called, then all numeric fields start at 0 and nullable fields are null
