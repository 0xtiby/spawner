# spawner

> A unified TypeScript interface to spawn and interact with AI coding CLIs.

[![npm version](https://img.shields.io/npm/v/@0xtiby/spawner)](https://www.npmjs.com/package/@0xtiby/spawner)
[![license](https://img.shields.io/npm/l/@0xtiby/spawner)](./LICENSE)

## What It Does

Spawner gives you a single async iterable API to drive **Claude Code**, **Codex CLI**, and **OpenCode** programmatically. You pass `SpawnOptions`, iterate over typed `CliEvent` objects, and get back a structured `CliResult` -- regardless of which CLI you choose. It handles process spawning, JSONL stream parsing, session management, error classification, and CLI detection so you can build orchestrators, CI pipelines, and editor integrations without writing per-CLI adapters.

**ESM only. Zero runtime dependencies. TypeScript-first.**

## Quick Start

```bash
pnpm add @0xtiby/spawner
```

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

**Prerequisites**: Node.js 18+, pnpm (or npm/yarn)

You also need at least one supported CLI installed and authenticated:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [OpenCode](https://github.com/sst/opencode) (`opencode`)

```bash
pnpm add @0xtiby/spawner
# or
npm install @0xtiby/spawner
# or
yarn add @0xtiby/spawner
```

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

```typescript
import { KNOWN_MODELS, getKnownModels, listModels } from '@0xtiby/spawner';

// All known models
console.log(KNOWN_MODELS);

// Models for a specific CLI
const claudeModels = getKnownModels('claude');

// Filter by CLI and provider
const openaiModels = listModels({ provider: 'openai' });
```

## CLI Feature Parity

Not every CLI supports every `SpawnOptions` field. This table shows what each adapter passes through and what it silently ignores.

| Feature | Claude | Codex | OpenCode |
|---|---|---|---|
| `model` | Yes | Yes | Yes |
| `sessionId` | Yes | Yes | Yes |
| `continueSession` | Yes | Yes | Yes |
| `forkSession` | Yes | Yes | Yes |
| `autoApprove` | Yes | Yes | -- |
| `effort` | Yes | Yes | -- |
| `addDirs` | Yes | Yes | -- |
| `ephemeral` | Yes | Yes | -- |
| `allowInteractiveTools` | Yes | -- | -- |
| `extraArgs` | Yes | Yes | Yes |

**Legend:** "Yes" = passed to the CLI. "--" = silently ignored.

## API Reference

### `spawn(options: SpawnOptions): CliProcess`

Spawns a CLI process and returns a handle for streaming events and awaiting the result.

#### `SpawnOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `cli` | `CliName` | *required* | Which CLI to spawn: `'claude'`, `'codex'`, or `'opencode'` |
| `prompt` | `string` | *required* | The prompt to send to the CLI |
| `cwd` | `string` | *required* | Working directory for the process |
| `model` | `string` | CLI default | Model identifier to use |
| `sessionId` | `string` | -- | Resume an existing session |
| `effort` | `'low' \| 'medium' \| 'high' \| 'max'` | -- | Effort level (supported by some models) |
| `autoApprove` | `boolean` | -- | Skip tool confirmation prompts |
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

Runs `detect()` for all three CLIs concurrently.

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

### `KNOWN_MODELS: KnownModel[]`

Static registry of known models across all supported CLIs.

### `getKnownModels(cli?: CliName): KnownModel[]`

Returns known models, optionally filtered by CLI.

### `listModels(options?: ListModelsOptions): KnownModel[]`

Returns known models filtered by CLI and/or provider.

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

## Known Models

> **Note:** `KNOWN_MODELS` is a static snapshot bundled with the package. It may not reflect the latest models available in each CLI. Use `listModels()` for programmatic access with filtering, and refer to each provider's official documentation for the most current model list.

| Model | Provider | CLI | Context Window | Effort Support |
|---|---|---|---|---|
| Claude Sonnet 4 | Anthropic | claude | 200k | Yes |
| Claude Opus 4 | Anthropic | claude | 200k | Yes |
| Claude 3.5 Haiku | Anthropic | claude | 200k | No |
| o4 Mini | OpenAI | codex | 200k | Yes |
| GPT-4.1 | OpenAI | codex | 128k | No |
| Claude Sonnet 4 (OpenCode) | Anthropic | opencode | 200k | No |
| GPT-4.1 (OpenCode) | OpenAI | opencode | 128k | No |

## Architecture

Spawner uses an **adapter pattern** to normalize differences between CLIs. Each CLI has an adapter that implements:

- **`buildCommand()`** -- Translates `SpawnOptions` into binary name, arguments, and optional stdin
- **`parseLine()`** -- Parses a JSONL line into normalized `CliEvent` objects
- **`detect()`** -- Checks installation and authentication
- **`classifyError()`** -- CLI-specific error classification with fallback to shared patterns

The `spawn()` function orchestrates the full lifecycle: adapter selection, child process spawning, readline-based stream parsing, event queuing via async iterable, accumulator tracking (session ID, token usage, model), and result construction on exit.

```
SpawnOptions
    |
    v
[ Adapter Selection ] --> buildCommand() --> child_process.spawn()
    |                                              |
    |                                        stdout (JSONL)
    |                                              |
    v                                              v
[ CLI Adapter ]                           [ Stream Parser ]
  - parseLine()                              - readline
  - classifyError()                          - accumulator
                                                   |
                                                   v
                                          [ Event Queue ]
                                        (AsyncIterable<CliEvent>)
                                                   |
                                                   v
                                             Your Code
```

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
