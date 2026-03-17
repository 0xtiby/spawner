# spawner

> A unified TypeScript interface to spawn and interact with AI coding CLIs.

Spawner lets you programmatically drive **Claude Code**, **Codex CLI**, and **OpenCode** through a single API. It handles process spawning, JSONL stream parsing, structured event emission, session management, error classification, and CLI detection -- so you can focus on building tools on top of these CLIs instead of wrestling with their individual quirks.

**ESM only. Zero runtime dependencies. TypeScript-first.**

## Why This Exists

Each AI coding CLI has its own binary, arguments, output format, and error behavior. If you want to build tooling that works across all of them -- orchestrators, CI pipelines, editor integrations -- you need to write adapters for each one. Spawner does that once, correctly, and gives you a clean async iterable of typed events in return.

## Quick Start

```bash
pnpm add spawner
```

```typescript
import { spawn } from 'spawner';

const process = spawn({
  cli: 'claude',
  prompt: 'Refactor the utils module to use named exports',
  cwd: '/path/to/project',
});

for await (const event of process.events) {
  switch (event.type) {
    case 'text':
      console.log(event.content);
      break;
    case 'tool_use':
      console.log(`Using tool: ${event.tool?.name}`);
      break;
    case 'tool_result':
      console.log(`Tool result: ${event.toolResult?.name}`);
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

const result = await process.done;
console.log(`Exited with code ${result.exitCode} in ${result.durationMs}ms`);
```

## Installation

**Prerequisites**: Node.js 18+, pnpm (or npm/yarn)

You also need at least one supported CLI installed and authenticated:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [OpenCode](https://github.com/sst/opencode) (`opencode`)

```bash
pnpm add spawner
# or
npm install spawner
# or
yarn add spawner
```

## Usage

### Spawning a CLI Process

`spawn()` is the main entry point. It returns a `CliProcess` with an async iterable of events and a promise that resolves when the process exits.

```typescript
import { spawn } from 'spawner';

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

### Resuming a Session

Pass `sessionId` to continue a previous conversation:

```typescript
const proc = spawn({
  cli: 'claude',
  prompt: 'Now add tests for the changes you just made',
  cwd: '/path/to/repo',
  sessionId: previousResult.sessionId!,
});
```

### Cancellation with AbortSignal

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

const result = await proc.done;
```

### Graceful Interruption

`interrupt()` sends SIGTERM, waits for a grace period, then escalates to SIGKILL:

```typescript
const result = await proc.interrupt(5000); // 5s grace period (default)
```

### Detecting Installed CLIs

```typescript
import { detect, detectAll } from 'spawner';

// Check a single CLI
const claude = await detect('claude');
// { installed: true, version: '1.2.3', authenticated: true, binaryPath: '/usr/local/bin/claude' }

// Check all CLIs concurrently
const all = await detectAll();
// { claude: DetectResult, codex: DetectResult, opencode: DetectResult }
```

### Extracting Results from Raw Output

If you have captured JSONL output from a previous CLI run, parse it without spawning a process:

```typescript
import { extract } from 'spawner';

const result = extract({
  cli: 'claude',
  rawOutput: capturedJsonlString,
});

console.log(result.sessionId);
console.log(result.usage);
```

### Error Classification

Classify raw stderr/stdout into structured error codes:

```typescript
import { classifyError } from 'spawner';

const error = classifyError('claude', 1, 'Rate limit exceeded. Try again in 30 seconds.', '');
// {
//   code: 'rate_limit',
//   message: 'Rate limit exceeded. Try again in 30 seconds.',
//   retryable: true,
//   retryAfterMs: 30000,
//   raw: '...'
// }
```

### Querying the Model Registry

```typescript
import { KNOWN_MODELS, getKnownModels, listModels } from 'spawner';

// All known models
console.log(KNOWN_MODELS);

// Models for a specific CLI
const claudeModels = getKnownModels('claude');

// Filter by CLI and provider
const openaiModels = listModels({ provider: 'openai' });
```

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

## Error Handling

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
import { spawn, type CliResult } from 'spawner';

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
