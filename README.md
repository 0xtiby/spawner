<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/spawner-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./assets/spawner-logo-light.png">
    <img alt="spawner" src="./assets/spawner-logo-light.png" height="140" style="margin-bottom: 20px;">
  </picture>
</div>

<p align="center">A unified TypeScript interface to spawn and interact with AI coding CLIs.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@0xtiby/spawner"><img src="https://img.shields.io/npm/v/@0xtiby/spawner" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@0xtiby/spawner" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@0xtiby/spawner" alt="node engine"></a>
  <a href="https://github.com/0xtiby/spawner/actions/workflows/release.yml"><img src="https://github.com/0xtiby/spawner/actions/workflows/release.yml/badge.svg" alt="CI status"></a>
</p>

## What Is Spawner?

A single async iterable API to drive **Claude Code**, **Codex CLI**, **OpenCode**, and **pi** programmatically:

1. You pass `SpawnOptions` to `spawn()`.
2. You iterate typed `CliEvent` objects as they stream in (text, tool use, tool result, errors).
3. You get back a structured `CliResult` -- same shape regardless of which CLI you chose.

It handles process spawning, JSONL stream parsing, session management, error classification, and CLI detection so you can build orchestrators, CI pipelines, and editor integrations without writing per-CLI adapters.

**ESM only. Zero runtime dependencies. TypeScript-first.**

> Used by [**looper**](https://github.com/0xtiby/looper) as its CLI driver.

## Quick Start

```typescript
import { spawn } from '@0xtiby/spawner';

const proc = spawn({
  cli: 'claude',
  prompt: 'Refactor the utils module to use named exports',
  cwd: '/path/to/project',
});

for await (const event of proc.events) {
  switch (event.type) {
    case 'text':
      console.log(event.content);
      break;
    case 'tool_use':
      console.log(`Using tool: ${event.tool?.name}`);
      break;
    case 'error':
      console.error(event.content);
      break;
    case 'done':
      console.log('Session:', event.result?.sessionId);
      console.log('Tokens:', event.result?.usage?.totalTokens);
      break;
  }
}
```

## Installation

```bash
pnpm add @0xtiby/spawner
# or: npm install @0xtiby/spawner
```

**Prerequisites**: Node.js 18+ and at least one supported CLI installed and authenticated:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [OpenCode](https://github.com/sst/opencode) (`opencode`)
- [pi](https://github.com/badlogic/pi-mono) (`pi`)

## CLI Feature Parity

Not every CLI supports every `SpawnOptions` field. This table shows what each adapter passes through and what it silently ignores.

| Feature | Claude | Codex | OpenCode | pi |
|---|---|---|---|---|
| `model` | Yes | Yes | Yes | Yes |
| `sessionId` | Yes | Yes | Yes | Yes |
| `continueSession` | Yes | Yes | Yes | Yes |
| `forkSession` | Yes | Yes | Yes | Yes |
| `autoApprove` | Yes | Yes | -- | No-op |
| `effort` | Yes | Yes | -- | Yes |
| `addDirs` | Yes | Yes | -- | -- |
| `ephemeral` | Yes | Yes | -- | Yes |
| `allowInteractiveTools` | Yes | -- | -- | -- |
| `extraArgs` | Yes | Yes | Yes | Yes |

**Legend:** "Yes" = passed to the CLI. "--" = silently ignored. "No-op" = accepted but has no effect (the CLI is already non-interactive).

### Pi-specific notes

- `autoApprove` is a no-op: `pi --mode json` is already a headless print mode with no approval prompts.
- `addDirs` and `allowInteractiveTools` are silently ignored so existing `SpawnOptions` work without crashing.
- `effort` is mapped to `--thinking <level>`. `off` and `minimal` are dropped (pi has no equivalent); `max`/`xhigh` map to `xhigh`.

## Core Concepts

### Streaming Events

`spawn()` returns a `CliProcess` whose `events` property is an `AsyncIterable<CliEvent>`. Each event carries a `type` field that tells you what happened. Iterate with `for await...of` to process events as they stream in.

| Type | When It Fires | Key Fields |
|---|---|---|
| `text` | The CLI emits a chunk of assistant text | `content` |
| `tool_use` | The CLI invokes a tool | `tool.name`, `tool.input` |
| `tool_result` | A tool call completes | `toolResult.name`, `toolResult.output`, `toolResult.error` |
| `error` | The CLI reports an inline error | `content` |
| `system` | Internal lifecycle signals (session start, step boundaries) | `content` |
| `done` | The process exits | `result` (contains `CliResult`) |

Every event also includes `timestamp` (Unix ms) and `raw` (the original JSONL line).

### Session Management

Use these `SpawnOptions` fields to control session behavior:

| Goal | Options to Set |
|---|---|
| Start a new session | *(none -- this is the default)* |
| Resume a session by ID | `sessionId: '<id>'` |
| Resume the most recent session | `continueSession: true` |
| Fork from a specific session | `sessionId: '<id>'`, `forkSession: true` |
| Fork from the most recent session | `continueSession: true`, `forkSession: true` |

`forkSession` is additive -- it only takes effect when you also set `sessionId` or `continueSession`. A fork creates a new session branched from the specified point, leaving the original session unchanged.

### Error Classification

When a CLI process exits with a non-zero code, spawner runs the output through `classifyError()` and attaches a structured `CliError` to the result. Each error has a `code`, a human-readable `message`, a `retryable` flag, and an optional `retryAfterMs` hint. You can use the `retryable` flag to build automatic retry logic. See the [Error Codes](#error-codes) section for the full list.

## Usage

### Spawn a Process

`spawn()` is the main entry point. It returns a `CliProcess` with an async iterable of events and a promise that resolves when the process exits.

```typescript
import { spawn } from '@0xtiby/spawner';

const proc = spawn({
  cli: 'codex',
  prompt: 'Add input validation to the signup handler',
  cwd: '/path/to/repo',
  model: 'o4-mini',
  autoApprove: true,
});

// Stream events as they arrive
for await (const event of proc.events) {
  if (event.type === 'text') {
    process.stdout.write(event.content ?? '');
  }
}

// Or just await the final result
const result = await proc.done;
```

### Resume or Fork a Session

Pass `sessionId` to continue a previous conversation, or combine it with `forkSession` to branch off:

```typescript
// Resume an existing session
const proc = spawn({
  cli: 'claude',
  prompt: 'Now add tests for the changes you just made',
  cwd: '/path/to/repo',
  sessionId: previousResult.sessionId!,
});

// Fork from an existing session (creates a new branch)
const forked = spawn({
  cli: 'claude',
  prompt: 'Try a different approach to the refactor',
  cwd: '/path/to/repo',
  sessionId: previousResult.sessionId!,
  forkSession: true,
});

// Resume the most recent session (no ID needed)
const continued = spawn({
  cli: 'claude',
  prompt: 'What was I working on?',
  cwd: '/path/to/repo',
  continueSession: true,
});
```

### Cancel or Interrupt

Use `AbortSignal` for external cancellation, or call `interrupt()` for a graceful shutdown:

```typescript
const controller = new AbortController();

const proc = spawn({
  cli: 'claude',
  prompt: 'Perform a large refactor',
  cwd: '/path/to/repo',
  abortSignal: controller.signal,
});

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

// Or interrupt gracefully (SIGTERM, then SIGKILL after grace period)
const result = await proc.interrupt(5000); // 5s grace period (default)
```

### Detect Installed CLIs

```typescript
import { detect, detectAll } from '@0xtiby/spawner';

// Check a single CLI
const claude = await detect('claude');
// { installed: true, version: '1.2.3', authenticated: true, binaryPath: '/usr/local/bin/claude' }

// Check all CLIs concurrently
const all = await detectAll();
// { claude: DetectResult, codex: DetectResult, opencode: DetectResult }
```

### Extract Results from Raw Output

If you have captured JSONL output from a previous CLI run, parse it without spawning a process:

```typescript
import { extract } from '@0xtiby/spawner';

const result = extract({
  cli: 'claude',
  rawOutput: capturedJsonlString,
});

console.log(result.sessionId);
console.log(result.usage);
```

### Query the Model Registry

Models are fetched dynamically from [models.dev](https://models.dev) and cached for 24 hours.

```typescript
import { listModels, getKnownModels, refreshModels } from '@0xtiby/spawner';

// All models from all providers
const all = await listModels();

// Models for a specific CLI
const claudeModels = await getKnownModels('claude');

// Filter by provider
const openaiModels = await listModels({ provider: 'openai' });

// With offline fallback
const models = await listModels({
  cli: 'claude',
  fallback: [{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200_000, supportsEffort: true }],
});

// Force-refresh the cache
await refreshModels();
```

## API Reference

### `spawn(options: SpawnOptions): CliProcess`

Spawns a CLI process and returns a handle for streaming events and awaiting the result.

#### `SpawnOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `cli` | `CliName` | *required* | Which CLI to spawn: `'claude'`, `'codex'`, `'opencode'`, or `'pi'` |
| `prompt` | `string` | *required* | The prompt to send to the CLI |
| `cwd` | `string` | *required* | Working directory for the process |
| `model` | `string` | CLI default | Model identifier to use |
| `sessionId` | `string` | -- | Resume an existing session |
| `effort` | `'off' \| 'minimal' \| 'low' \| 'medium' \| 'high' \| 'max' \| 'xhigh'` | -- | Effort/reasoning level (supported by some models) |
| `autoApprove` | `boolean` | -- | Skip tool confirmation prompts. Maps to full permission/sandbox bypass on claude (`--dangerously-skip-permissions`) and codex (`--dangerously-bypass-approvals-and-sandbox`). No effect on opencode. |
| `forkSession` | `boolean` | -- | Fork from an existing session |
| `continueSession` | `boolean` | -- | Continue the most recent session |
| `addDirs` | `string[]` | -- | Additional directories to include |
| `ephemeral` | `boolean` | -- | Run without persisting session |
| `verbose` | `boolean` | -- | Enable debug logging to stderr |
| `allowInteractiveTools` | `boolean` | -- | Allow tools that prompt the user for input (Claude only) |
| `abortSignal` | `AbortSignal` | -- | Signal to abort the process |
| `extraArgs` | `string[]` | -- | Additional CLI arguments passed through |

#### `CliProcess`

| Property / Method | Type | Description |
|---|---|---|
| `events` | `AsyncIterable<CliEvent>` | Stream of parsed events |
| `pid` | `number` | OS process ID |
| `interrupt(graceMs?)` | `(graceMs?: number) => Promise<CliResult>` | Gracefully stop the process (SIGTERM, then SIGKILL after `graceMs`) |
| `done` | `Promise<CliResult>` | Resolves when the process exits |

#### `CliEvent`

| Field | Type | Description |
|---|---|---|
| `type` | `CliEventType` | `'text'`, `'tool_use'`, `'tool_result'`, `'error'`, `'system'`, or `'done'` |
| `timestamp` | `number` | Unix timestamp (ms) |
| `content` | `string?` | Text content (for `text`, `error`, `system` events) |
| `tool` | `{ name: string; input?: Record<string, unknown> }?` | Tool invocation details (for `tool_use` events) |
| `toolResult` | `{ name: string; output?: string; error?: string }?` | Tool result (for `tool_result` events) |
| `result` | `CliResult?` | Final result (only on `done` events) |
| `raw` | `string` | Original JSONL line |

#### `CliResult`

| Field | Type | Description |
|---|---|---|
| `exitCode` | `number` | Process exit code |
| `sessionId` | `string \| null` | Session ID for resumption |
| `usage` | `TokenUsage \| null` | Token usage and cost |
| `model` | `string \| null` | Model that was used |
| `error` | `CliError \| null` | Structured error (if non-zero exit) |
| `durationMs` | `number` | Wall-clock duration in milliseconds |

#### `TokenUsage`

| Field | Type |
|---|---|
| `inputTokens` | `number \| null` |
| `outputTokens` | `number \| null` |
| `totalTokens` | `number \| null` |
| `cost` | `number \| null` |

### `detect(cli: CliName): Promise<DetectResult>`

Checks whether a CLI is installed, its version, and authentication status.

### `detectAll(): Promise<Record<CliName, DetectResult>>`

Runs `detect()` for all four CLIs concurrently.

### `extract(options: ExtractOptions): CliResult`

Parses captured JSONL output into a `CliResult` without spawning a process. Useful for processing saved output or testing.

### `classifyError(cli, exitCode, stderr, stdout): CliError`

Classifies raw process output into a structured `CliError` using CLI-specific adapters.

### `classifyErrorDefault(exitCode, stderr, stdout): CliError`

Default error classifier using shared pattern matching. Useful for building custom adapters.

### `matchSharedPatterns(stderr, stdout)`

Low-level pattern matching against the shared error pattern table. Returns `{ code, retryable, matchedLine }` or `null`.

### `parseRetryAfterMs(text): number`

Extracts a retry-after duration (in ms) from error text. Returns `60000` as a default fallback.

### `listModels(options?: ListModelsOptions): Promise<KnownModel[]>`

Returns models fetched from models.dev, filtered by CLI and/or provider. Results are sorted alphabetically by `id`. When both `cli` and `provider` are set, `provider` takes precedence.

### `getKnownModels(cli?: CliName, fallback?: KnownModel[]): Promise<KnownModel[]>`

Convenience wrapper over `listModels()`. Returns models optionally filtered by CLI, with optional fallback on fetch failure.

### `refreshModels(): Promise<void>`

Force-refreshes the in-memory model cache from models.dev. On failure, the existing cache is preserved.

## Error Codes

Spawner classifies CLI errors into typed error codes so you can handle them programmatically:

| Error Code | Retryable | Description |
|---|---|---|
| `rate_limit` | Yes | Rate limited or overloaded -- check `retryAfterMs` |
| `auth` | No | Not authenticated or invalid credentials |
| `session_not_found` | No | Session ID does not exist |
| `model_not_found` | No | Specified model is invalid |
| `context_overflow` | No | Input exceeds model context window |
| `permission_denied` | No | Tool use requires confirmation |
| `binary_not_found` | No | CLI binary not found on PATH |
| `fatal` | No | Non-recoverable process error |
| `unknown` | No | Unrecognized error |

### Retry Example

```typescript
import { spawn, type CliResult } from '@0xtiby/spawner';

async function spawnWithRetry(options: Parameters<typeof spawn>[0], maxRetries = 3): Promise<CliResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const proc = spawn(options);
    const result = await proc.done;

    if (!result.error?.retryable || attempt === maxRetries) {
      return result;
    }

    const delay = result.error.retryAfterMs ?? 60_000;
    console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error('unreachable');
}
```

## Models

Models are fetched dynamically from [models.dev](https://models.dev) and cached in memory for 24 hours. There is no static model list -- call `listModels()` or `getKnownModels()` to get the current catalog. Use `refreshModels()` to force a cache refresh.

## Architecture

Spawner uses an **adapter pattern** to normalize differences between CLIs. Each CLI has an adapter that implements:

- **`buildCommand()`** -- Translates `SpawnOptions` into binary name, arguments, and optional stdin
- **`parseLine()`** -- Parses a JSONL line into normalized `CliEvent` objects
- **`detect()`** -- Checks installation and authentication
- **`classifyError()`** -- CLI-specific error classification with fallback to shared patterns

The `spawn()` function orchestrates the full lifecycle: adapter selection, child process spawning, readline-based stream parsing, event queuing via async iterable, accumulator tracking (session ID, token usage, model), and result construction on exit.

## Examples

### Interactive Chat TUI

`examples/chat.ts` is a fully working terminal chat app built on spawner. It auto-detects installed CLIs, lets you pick one, then drops you into a streaming chat loop with session continuity.

```bash
pnpm tsx examples/chat.ts
```

Features:
- **CLI selection** -- detects installed CLIs, shows versions and auth status, prompts you to pick one
- **Streaming responses** -- text streams to stdout in real-time with colored labels
- **Tool-use indicators** -- shows which tools the CLI invokes during a response
- **Session continuity** -- captures `sessionId` so follow-up messages continue the conversation
- **Ctrl+C interrupt** -- interrupts a streaming response without killing the app
- **Slash commands** -- `/exit` to quit, `/new` to start a fresh session with a different CLI
- **Error handling** -- rate limits, auth failures, and CLI crashes are caught and displayed cleanly

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests (334 tests across 20 files)
pnpm test

# Type-check without emitting
pnpm lint
```

## License

MIT
