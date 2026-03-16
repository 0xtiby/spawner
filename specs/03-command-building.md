---
title: "Spec: Command Building"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, command-building]
---

# Command Building

## Overview

Each adapter translates `SpawnOptions` into a concrete command + args array that can be passed to `child_process.spawn()`. This is the adapter's `buildCommand()` method.

**Source:** `src/adapters/{claude,codex,opencode}.ts`

## Scope

**In:** Mapping SpawnOptions fields to CLI-specific flags, prompt delivery strategy, session handling logic.

**Out:** Actually spawning the process (that's spec 05), parsing output (spec 04).

---

## Adapter Interface

```typescript
buildCommand(options: SpawnOptions): {
  bin: string;       // Binary name (e.g., 'claude')
  args: string[];    // Command-line arguments
  stdinInput?: string; // Content to pipe to stdin (the prompt)
}
```

The prompt is always delivered via `stdinInput` for all three CLIs.

---

## Claude Code

### Base command

```
claude --print --output-format stream-json --verbose
```

Always includes `--print` (non-interactive), `--output-format stream-json` (JSONL output), and `--verbose` (richer output).

### Flag mapping

| SpawnOption | Flag | Notes |
|-------------|------|-------|
| `model` | `--model <model>` | |
| `sessionId` | `--resume <sessionId>` | |
| `continueSession` | `--continue` | |
| `forkSession` | `--fork-session` | Combine with `--resume` or `--continue` |
| `effort` | `--effort <effort>` | `'max'` only valid for Opus 4.6 |
| `autoApprove` | `--dangerously-skip-permissions` | |
| `addDirs` | `--add-dir <dir>` (repeated) | One `--add-dir` per directory |
| `ephemeral` | `--no-session-persistence` | |
| `extraArgs` | Appended as-is | |

### Session logic

- `sessionId` set → `--resume <sessionId>`
- `continueSession` set → `--continue`
- `forkSession` set → append `--fork-session` (must combine with `--resume` or `--continue`)
- None set → new session

### Prompt delivery

Pipe `options.prompt` to stdin.

---

## Codex

### Base command

The base command depends on session state:

- **New session:** `codex exec --json`
- **Resume by ID:** `codex exec resume <sessionId>`
- **Resume last:** `codex exec resume --last`
- **Fork:** `codex fork <sessionId>`

### Flag mapping

| SpawnOption | Flag | Notes |
|-------------|------|-------|
| `model` | `--model <model>` | |
| `autoApprove` | `--full-auto` | For unrestricted: use `extraArgs: ['--yolo']` |
| `addDirs` | `--add-dir <dir>` (repeated) | |
| `ephemeral` | `--ephemeral` | |
| `effort` | `-c model_reasoning_effort=<effort>` | Config flag syntax |
| `extraArgs` | Appended as-is | |

### Session logic

- `sessionId` set, `forkSession` not set → `codex exec resume <sessionId>` (prompt becomes follow-up via stdin)
- `continueSession` set → `codex exec resume --last`
- `forkSession` + `sessionId` → `codex fork <sessionId>` (no prompt piped)
- None set → `codex exec`

### Prompt delivery

Pipe `options.prompt` to stdin for `exec` and `exec resume` modes. For `fork` mode, `options.prompt` is silently ignored — the fork command creates a branch of an existing session and does not accept new input.

### Unsupported options

- `effort: 'max'` — not applicable (OpenAI models)
- If an unsupported option is set, ignore it silently (the adapter does not warn).

---

## OpenCode

### Base command

```
opencode run --format json
```

### Flag mapping

| SpawnOption | Flag | Notes |
|-------------|------|-------|
| `model` | `--model <provider/model>` | Uses `provider/model` format |
| `sessionId` | `--session <sessionId>` | |
| `continueSession` | `--continue` | |
| `forkSession` | `--fork` | Combine with `--session` or `--continue` |
| `extraArgs` | Appended as-is | |

### Session logic

- `sessionId` set → `--session <sessionId>`
- `continueSession` set → `--continue`
- `forkSession` set → `--fork` (combine with `--session` or `--continue`)
- None set → new session

### Unsupported options (silently ignored)

- `autoApprove` — OpenCode has no auto-approve mode
- `addDirs` — not supported
- `ephemeral` — not supported
- `effort` — not supported

### Prompt delivery

Pipe `options.prompt` to stdin.

---

## Conflicting Options

If conflicting options are provided, apply this precedence:

1. `sessionId` takes precedence over `continueSession` (explicit ID wins over "resume last")
2. `forkSession` is additive — it modifies resume/continue behavior, never used alone
3. If `forkSession` is set without `sessionId` or `continueSession`, ignore it (nothing to fork from)

---

## Acceptance Criteria

- Given `{ cli: 'claude', prompt: 'hello', cwd: '/tmp' }`, when `buildCommand()` is called, then the result is `{ bin: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose'], stdinInput: 'hello' }`
- Given `{ cli: 'claude', sessionId: 'abc', forkSession: true }`, when `buildCommand()` is called, then args include `--resume abc --fork-session`
- Given `{ cli: 'codex', sessionId: 'abc' }`, when `buildCommand()` is called, then the bin/args form `codex exec resume abc`
- Given `{ cli: 'codex', forkSession: true, sessionId: 'abc' }`, when `buildCommand()` is called, then the bin/args form `codex fork abc`
- Given `{ cli: 'opencode', autoApprove: true }`, when `buildCommand()` is called, then `autoApprove` is silently ignored (no flag added)
- Given `{ cli: 'claude', addDirs: ['/a', '/b'] }`, when `buildCommand()` is called, then args include `--add-dir /a --add-dir /b`
- Given `extraArgs: ['--max-turns', '10']`, when `buildCommand()` is called for any CLI, then those args are appended at the end
