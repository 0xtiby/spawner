---
title: "Spec: Testing Strategy"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, testing]
---

# Testing Strategy

## Overview

Test architecture for the spawner package. Combines fixture-based parser tests with mocked `child_process` integration tests. E2E validation uses a live CLI script.

**Source:** `test/`, `scripts/test-e2e.ts`

## Scope

**In:** Test structure, fixture format, mocking approach, test scenarios per module, e2e script.

**Out:** CI/CD pipeline, publishing.

---

## Test Framework

**Vitest** — fast, TypeScript-native, ESM-first. Configuration in `vitest.config.ts`.

---

## Test Structure

```
test/
  fixtures/
    claude/
      text-response.jsonl        # Simple text output
      tool-use.jsonl             # Tool invocation + result
      session-resume.jsonl       # Resume session output
      error-rate-limit.jsonl     # Rate limit error output
      malformed.jsonl            # Mix of valid and invalid lines
    codex/
      text-response.jsonl
      tool-use.jsonl
      error-auth.jsonl
    opencode/
      text-response.jsonl
      tool-use.jsonl
      step-finish.jsonl
  adapters/
    claude.test.ts               # Claude adapter unit tests
    codex.test.ts                # Codex adapter unit tests
    opencode.test.ts             # OpenCode adapter unit tests
  core/
    spawn.test.ts                # Spawn + process lifecycle tests
    detect.test.ts               # Detection tests
    stream.test.ts               # Stream wiring tests
    extract.test.ts              # Extract tests
    errors.test.ts               # Error classification tests
  models.test.ts                 # Known models registry tests
scripts/
  test-e2e.ts                    # Live CLI validation
```

---

## Layer 1: Fixture-Based Parser Tests

Test each adapter's `parseLine()` with recorded JSONL fixtures.

### Fixture format

Each `.jsonl` file contains actual (or realistic) output from the CLI, one JSON object per line. Files are read with `fs.readFileSync` in tests.

### Test scenarios per adapter

| Scenario | What to verify |
|----------|---------------|
| Text response | `parseLine()` returns `text` events with correct content |
| Tool use | `parseLine()` returns `tool_use` event with name and input |
| Tool result | `parseLine()` returns `tool_result` with output |
| Session metadata | Accumulator updated with `sessionId` and `model` |
| Token usage | Accumulator updated with `inputTokens`, `outputTokens`, `cost` |
| Malformed line | Returns `system` event, never throws |
| Empty line | Returns empty array |

### Example test structure

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { claudeAdapter } from '../src/adapters/claude';
import { createAccumulator } from '../src/adapters/types';

describe('Claude adapter parseLine', () => {
  it('parses text response', () => {
    const lines = readFileSync('test/fixtures/claude/text-response.jsonl', 'utf-8').split('\n');
    const acc = createAccumulator();
    const events = lines.flatMap(line => claudeAdapter.parseLine(line, acc));

    const textEvents = events.filter(e => e.type === 'text');
    expect(textEvents.length).toBeGreaterThan(0);
    expect(textEvents[0].content).toBeDefined();
  });

  it('survives malformed JSON', () => {
    const acc = createAccumulator();
    const events = claudeAdapter.parseLine('not json at all', acc);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
    expect(events[0].raw).toBe('not json at all');
  });
});
```

---

## Layer 2: Mocked child_process Integration Tests

Test `spawn()`, `detect()`, and `interrupt()` by mocking `child_process.spawn`.

### Mocking approach

Use Vitest's `vi.mock` to replace `child_process.spawn` with a fake that:

1. Returns a mock `ChildProcess` with `stdout`, `stderr`, `stdin` as readable/writable streams
2. Feeds recorded JSONL lines through `stdout` on demand
3. Emits `close` event with a configurable exit code

### Helper: createMockProcess

```typescript
function createMockProcess(options: {
  stdoutLines: string[];
  stderrLines?: string[];
  exitCode?: number;
  delay?: number;  // ms between lines
}): MockChildProcess
```

### spawn.test.ts scenarios

| Scenario | Setup | Verify |
|----------|-------|--------|
| Happy path | Feed text JSONL, exit 0 | Events arrive in order, `done` resolves with correct CliResult |
| ENOENT | Mock emits error with `code: 'ENOENT'` | `done` rejects with `binary_not_found` |
| Non-zero exit | Feed some output, exit 1 + stderr | `CliResult.error` is populated |
| Interrupt | Feed slow output, call `interrupt()` | SIGTERM sent, process killed, `done` resolves |
| AbortSignal | Feed slow output, abort the signal | Same as interrupt |
| Stdin delivery | Any options with prompt | Verify `stdin.write` called with prompt, `stdin.end` called |

### detect.test.ts scenarios

| Scenario | Setup | Verify |
|----------|-------|--------|
| Installed + authed | `--version` exits 0 with version string, auth exits 0 | Full positive DetectResult |
| Not installed | `--version` ENOENT | `installed: false` |
| Installed, not authed | `--version` OK, auth exits 1 | `installed: true, authenticated: false` |
| Timeout | `--version` hangs | After 10s, returns with `version: null` |
| detectAll | All three checked | Runs concurrently, returns Record |

### errors.test.ts scenarios

| Scenario | Input | Expected code |
|----------|-------|---------------|
| Rate limit stderr | `"rate limit exceeded"` | `rate_limit` |
| Auth failure | `"not authenticated"` | `auth` |
| Unknown error | `"something unexpected"` | `fatal` |
| Priority order | stderr matches both `rate_limit` and `auth` | `rate_limit` (first in priority) |

---

## Layer 3: E2E Script

The `scripts/test-e2e.ts` script from the package spec. Run manually with `npx tsx scripts/test-e2e.ts`.

### What it does

1. `detect(CLI)` — verify CLI is available
2. `spawn()` — first run with a prompt that triggers tool use + asks a question
3. Stream all events to console in real-time
4. Capture session ID from result
5. Wait 2 seconds
6. `spawn()` — resume with session ID and a follow-up answer

### What to verify manually

- Events print as the CLI works (live streaming, not batched)
- `tool_use` / `tool_result` events fire
- Session ID is captured
- Resume works (CLI has context)
- Token usage reported

The full script is specified in the package spec under "Test Script Specification".

---

## Running Tests

```bash
# Unit + integration tests
npx vitest

# Watch mode
npx vitest --watch

# E2E (requires CLI installed + authenticated)
npx tsx scripts/test-e2e.ts
```

---

## Acceptance Criteria

- Given the test suite runs, when no CLI binaries are installed, then all unit and integration tests pass (only mocked child_process)
- Given a fixture file is loaded, when parseLine is called for each line, then events match expected types and content
- Given a mock process feeds JSONL lines, when spawn() is called and events are iterated, then events arrive in order
- Given the e2e script runs with a real CLI, when it completes, then it prints session ID, token usage, and "Test complete"
