---
title: "Spec: Pi Adapter"
created: 2026-04-27
updated: 2026-04-27
tags: [spawner, spec, adapter, pi]
---

# Pi Adapter

## Overview

Add a `pi` adapter that drives the [pi-mono](https://github.com/badlogic/pi-mono) coding agent in headless mode via `pi --mode json`. Pi emits a JSONL event stream of `AgentSessionEvent` objects which the adapter parses into normalized `CliEvent` objects.

**Source:** `src/adapters/pi.ts`.

## Scope

**In:** Adapter implementation (`detect`, `buildCommand`, `parseLine`, `classifyError`), JSONL event parsing, error classification, integration with the shared effort-mapping module.

**Out:** Interactive TUI mode, real-time auth validation, parsing `pi --list-models` output (spawner uses models.dev), pi-specific options outside `SpawnOptions` (users can pass via `extraArgs`).

---

## Public Behavior

### `detect()`

- Runs `pi --version` to derive the version string and binary presence.
- `installed: false` when the binary is missing (`ENOENT`).
- `authenticated: true` is reported optimistically because pi's auth is provider-specific and runtime-determined; real auth failures surface via `classifyError` at runtime.

### `buildCommand(options)`

Always emits `pi --mode json` plus translated flags. The prompt is appended as the final positional argument so that `extraArgs` are parsed as flags before it.

| `SpawnOptions` field | Pi flag | Notes |
|---|---|---|
| `model` | `--model <id>` | Direct passthrough |
| `sessionId` | `--session <id>` | Resume an existing session |
| `continueSession` | `--continue` | Used only when `sessionId` is unset |
| `forkSession` + `sessionId` | `--fork <id>` | Strips `--session`/`--continue` first |
| `ephemeral` | `--no-session` | Run without persisting session |
| `verbose` | `--verbose` | Debug logging to stderr |
| `effort` | `--thinking <level>` | Via `mapEffortToCliFlag('pi', effort)` |
| `extraArgs` | passthrough | Inserted before the positional prompt |
| `prompt` | positional | Appended last |
| `autoApprove` | -- | No-op (`--mode json` is non-interactive) |
| `addDirs` | -- | Silently ignored |
| `allowInteractiveTools` | -- | Silently ignored |

### `parseLine(line, accumulator)`

Each non-empty line is parsed as JSON; malformed lines fall through to a single `system` event preserving the raw line.

### `classifyError(exitCode, stderr, stdout)`

Pattern-matches stderr/stdout against pi-specific regexes; otherwise delegates to `classifyErrorDefault`.

---

## Event Type Mapping

| Pi event `type` | Spawner `CliEvent` | Notes |
|---|---|---|
| `session` | `system` | Captures `id` → `accumulator.sessionId`, `model` → `accumulator.model` |
| `agent_start` | `system` | Lifecycle marker |
| `turn_start` | `system` | Lifecycle marker |
| `message_start` (assistant) | -- | No event; updates `accumulator.model` |
| `message_update` → `text_end` | `text` | `content` from the assistant event |
| `message_update` → `toolcall_end` | `tool_use` | `tool.name`, `tool.input` from `toolCall` |
| `message_update` → `error` | `error` | `errorMessage` from the assistant event |
| `message_update` → `thinking_*` | -- | Skipped (matches Claude/Codex behavior) |
| `message_end` (assistant) | -- or `error` | Updates token usage; emits `error` when `stopReason` is `error`/`aborted` |
| `tool_execution_start` | -- | Skipped |
| `tool_execution_update` | -- | Skipped |
| `tool_execution_end` | `tool_result` | `toolResult.name`, `output`, `error` if `isError` |
| `turn_end` | `system` (or `error`) | Updates token usage; emits `error` on `stopReason: error|aborted` |
| `agent_end` | `system` | Lifecycle marker |
| *unknown* | `system` | Fallback preserves the raw line |

---

## Session Management

| Goal | Flags emitted |
|---|---|
| New session (default) | none |
| Resume by ID | `--session <id>` |
| Resume most recent | `--continue` |
| Fork from a known session | `--fork <id>` (strips `--session`/`--continue`) |
| Run ephemerally | `--no-session` |

`forkSession` only takes effect when `sessionId` is set; `--fork` requires an explicit identifier.

---

## Effort Mapping

`SpawnOptions.effort` (the unified `EffortLevel`) is translated by the centralized `mapEffortToCliFlag('pi', effort)` helper.

| `EffortLevel` | Pi flag |
|---|---|
| `off` | -- (dropped) |
| `minimal` | -- (dropped) |
| `low` | `--thinking low` |
| `medium` | `--thinking medium` |
| `high` | `--thinking high` |
| `max` | `--thinking xhigh` |
| `xhigh` | `--thinking xhigh` |

---

## Error Classification

Pi-specific patterns checked in this order; first match wins. A non-match falls through to `classifyErrorDefault`.

| `CliErrorCode` | Regex (case-insensitive) | Retryable |
|---|---|---|
| `model_not_found` | `model.*not found`, `not found.*model`, `unknown model` | `false` |
| `auth` | `api key`, `unauthorized`, `authentication` | `false` |
| `rate_limit` | `rate limit`, `too many requests`, `ratelimit` | `true` |
| `context_overflow` | `context.*length`, `too long`, `token limit`, `maximum context`, `context window` | `false` |

The `matchedLine` is the first stderr/stdout line that triggered the regex, trimmed.

---

## Testing Approach

- **Fixture-based replay** (`test/adapters/pi.test.ts`): real JSONL captured from `pi --mode json` is fed to `parseLine` and the emitted `CliEvent` sequence is asserted line-by-line. Coverage:
  - Text response parsing (`text_end`)
  - Tool call → `tool_use`
  - Tool execution → `tool_result`
  - Session header capture (sessionId + model on accumulator)
  - Token usage accumulation from `message_end` and `turn_end`
  - Error path: `stopReason: error` emits a `CliEvent` of type `error`
- **`buildCommand` tests**: assert flag composition for every `SpawnOptions` field combination, including `forkSession` precedence over `--session`/`--continue`.
- **`classifyError` tests**: each regex row exercised with a representative stderr/stdout line.
- **Effort mapping tests**: parametrized `(cli, effort) → flag` table including `off`/`minimal` drop and `max`/`xhigh` collapse.
- **Adapter registry test** (`src/adapters/index.test.ts`): `getAdapter('pi')` returns the pi adapter with all required methods.
- **E2E** (`test/e2e.test.ts`): `pi` is included in `CLI_NAMES`; spawn/listModels/session-continuity tests run when pi is installed and authenticated, otherwise skipped.
