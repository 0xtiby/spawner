---
title: "Spec: Spawn & Process"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, spawn, process]
---

# Spawn & Process

## Overview

Spawn a CLI process, wire up the stream parser, expose the event iterator and process lifecycle (interrupt, abort, done). This is the core orchestration that ties command building, stream parsing, and process management together.

**Source:** `src/core/spawn.ts`

## Scope

**In:** Process spawning, stdin delivery, event iterator construction, interrupt/SIGTERM/SIGKILL sequence, abort signal handling, `done` promise, duration tracking, debug logging.

**Out:** Command building (spec 03), stream parsing (spec 04), error classification (spec 06).

---

## Public API

```typescript
function spawn(options: SpawnOptions): CliProcess;
```

`spawn()` is **synchronous** — it returns immediately. The child process is already starting. Events flow through `events`. Final summary is available via `done`.

---

## Lifecycle

```
spawn() called
  ├─ adapter.buildCommand(options) → { bin, args, stdinInput }
  ├─ child_process.spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  ├─ Write stdinInput to stdin, then close stdin
  ├─ Wire readline on stdout → adapter.parseLine() → event queue
  ├─ Buffer stderr (+ emit as system events if verbose)
  ├─ Return CliProcess { events, pid, interrupt, done }
  │
  ├─ [events consumed by caller via for-await]
  │
  └─ Process exits
       ├─ Flush remaining buffered lines
       ├─ If non-zero exit → adapter.classifyError() → CliResult.error
       ├─ Build CliResult from accumulator + exit info
       ├─ Emit final 'done' event
       ├─ Resolve done promise with CliResult
       └─ Close event iterator
```

---

## Process Spawning

```typescript
const child = child_process.spawn(bin, args, {
  cwd: options.cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  // No shell: true — spawn the binary directly
});
```

### ENOENT Handling

If `child_process.spawn` emits an `error` event with `code: 'ENOENT'`, `spawn()` throws synchronously (before returning `CliProcess`).

Implementation: since `child_process.spawn` is itself synchronous but the ENOENT error arrives asynchronously on the next tick, we need to handle this carefully. Use a microtask check:

1. Call `child_process.spawn()`
2. Listen for the `error` event on the child
3. If ENOENT fires, reject `done` with a `CliError` of code `binary_not_found` and also cause the event iterator to throw

Since true synchronous throw isn't possible with async ENOENT, the practical behavior is: `done` rejects, and iterating `events` throws. The consumer sees the error whichever way they consume.

### Stdin Delivery

```typescript
if (stdinInput) {
  child.stdin.write(stdinInput);
  child.stdin.end();
}
```

Write the prompt, then close stdin so the CLI knows input is complete.

---

## Event Iterator

`events` is an `AsyncIterable<CliEvent>` implemented as an async generator or a custom async iterator backed by a queue.

### Implementation approach

Use an internal event queue (array + resolver pattern):

1. As `parseLine()` produces events, push them to the queue
2. If the consumer is awaiting the next event, resolve immediately
3. When the process exits and all events are flushed, close the iterator

This ensures backpressure-free delivery — events are buffered if the consumer is slow.

---

## Interrupt

```typescript
interrupt(graceMs?: number): Promise<CliResult>
```

Default `graceMs`: 5000ms.

### Sequence

1. Send `SIGTERM` to the child process: `child.kill('SIGTERM')`
2. Race: process exit vs `setTimeout(graceMs)`
3. If timeout wins: `child.kill('SIGKILL')`
4. Collect remaining buffered output
5. Run extraction on accumulated data
6. Resolve `done` with the (possibly partial) `CliResult`

### AbortSignal

If `options.abortSignal` is provided, listen for the `abort` event and trigger the same interrupt sequence:

```typescript
if (options.abortSignal) {
  options.abortSignal.addEventListener('abort', () => {
    interrupt();
  }, { once: true });
}
```

---

## Duration Tracking

Record `startTime = Date.now()` when `spawn()` is called. `durationMs = Date.now() - startTime` when the process exits. Stored in `CliResult.durationMs`.

---

## Done Promise

`done` resolves when:
1. The child process exits (via `close` event)
2. All remaining stdout/stderr is flushed and parsed
3. `CliResult` is constructed from:
   - `exitCode` from the process
   - `sessionId`, `model`, `usage` from the accumulator
   - `error` from `adapter.classifyError()` if exit code is non-zero
   - `durationMs` from timing

The `done` event is also emitted through the events iterator as the final event (with `result` field populated).

---

## Debug Logging

When `verbose: true` OR `NODE_DEBUG=spawner` is set:

1. **On spawn:** Log the full command: `[spawner] spawn: claude --print --output-format stream-json ...`
2. **On raw line:** Log each raw stdout line: `[spawner] stdout: {"type":"system",...}`
3. **On parsed event:** Log parsed event type: `[spawner] event: text (45 chars)`
4. **On stderr line:** Log stderr: `[spawner] stderr: ...`
5. **On exit:** Log exit code and duration: `[spawner] exit: code=0 duration=12345ms`

Use `process.stderr.write()` for debug output (not console.log) to avoid mixing with captured stdout.

Check `NODE_DEBUG` via: `process.env.NODE_DEBUG?.includes('spawner')`.

---

## Acceptance Criteria

- Given valid SpawnOptions, when `spawn()` is called, then it returns a `CliProcess` synchronously with a valid `pid`
- Given a CLI binary that doesn't exist, when `spawn()` is called, then `done` rejects with a CliError of code `binary_not_found`
- Given a running process, when `interrupt()` is called, then SIGTERM is sent first, and SIGKILL only after graceMs
- Given a running process, when the AbortSignal is aborted, then the interrupt sequence is triggered
- Given a process that outputs JSONL, when events are iterated, then they arrive in order as the CLI produces them (not batched at the end)
- Given a process that exits with code 0, when `done` resolves, then `CliResult.error` is null
- Given a process that exits with non-zero code, when `done` resolves, then `CliResult.error` is populated via `classifyError()`
- Given `verbose: true`, when the process runs, then command, raw lines, parsed events, and stderr are logged to process.stderr
- Given the process completes, when `done` resolves, then `durationMs` reflects wall-clock time from spawn to exit
- Given events are iterated with for-await, when the process exits, then the iterator completes (no hang)
