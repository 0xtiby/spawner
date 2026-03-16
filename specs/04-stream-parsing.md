---
title: "Spec: Stream Parsing"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, stream, parsing]
---

# Stream Parsing

## Overview

Parse raw JSONL/text output from each CLI's stdout into normalized `CliEvent` objects. Uses Node's `readline` interface for line buffering. Each adapter implements `parseLine()` to handle CLI-specific formats.

**Source:** `src/core/stream.ts` (readline wiring, event normalization) + `src/adapters/*.ts` (per-CLI parsing).

## Scope

**In:** Line-by-line JSONL parsing, event normalization, accumulator state management, stderr handling.

**Out:** Process spawning (spec 05), error classification (spec 06), post-hoc extraction (spec 07).

---

## Architecture

```
stdout → readline → adapter.parseLine() → CliEvent[]
                          ↓
                   SessionAccumulator (mutated)
```

1. `readline` reads stdout line-by-line (handles partial chunk buffering automatically)
2. Each complete line is passed to `adapter.parseLine(line, accumulator)`
3. The adapter parses the JSON, updates the accumulator, and returns zero or more `CliEvent` objects
4. Events are yielded through the `AsyncIterable<CliEvent>` on `CliProcess.events`

### Stderr Handling

- Always buffer stderr content for error classification (used on non-zero exit)
- When `verbose: true`, also emit each stderr line as a `system` event in real-time

---

## Adapter Interface

```typescript
parseLine(line: string, accumulator: SessionAccumulator): CliEvent[];
```

- Returns an array because one raw line may produce zero events (metadata-only) or multiple events (e.g., a message with both text and tool_use content blocks)
- The accumulator is mutated in-place — adapters write session ID, model, token counts as they appear
- Every returned event must have `raw` set to the original line

### Lenient Parsing

- If a line is not valid JSON, emit it as a `system` event with the raw content
- Never throw from `parseLine()` — all parse failures become system events
- Never drop lines silently

---

## Claude Code Parser

Raw output format: JSONL with `type` field.

### Raw types and mapping

| Raw `type` | Content | Maps to | Accumulator updates |
|------------|---------|---------|---------------------|
| `system` | Session/model metadata | `system` | `sessionId`, `model` |
| `assistant` | Text content blocks | `text` | — |
| `assistant` | Tool_use content blocks | `tool_use` | — |
| `result` | Final summary | `done` | `sessionId`, `model`, `inputTokens`, `outputTokens`, `cost` |

### Parsing logic

```
for each line:
  json = JSON.parse(line)
  switch json.type:
    'system':
      accumulator.sessionId = json.session_id ?? accumulator.sessionId
      accumulator.model = json.model ?? accumulator.model
      emit { type: 'system', content: summarize(json), raw: line }

    'assistant':
      for each block in json.message.content:
        if block.type === 'text':
          emit { type: 'text', content: block.text, raw: line }
        if block.type === 'tool_use':
          emit { type: 'tool_use', tool: { name: block.name, input: block.input }, raw: line }
        if block.type === 'tool_result':
          emit { type: 'tool_result', toolResult: { name: block.name, output: block.content, error: block.is_error ? block.content : undefined }, raw: line }

    'result':
      accumulator.sessionId = json.session_id ?? accumulator.sessionId
      accumulator.model = json.model ?? accumulator.model
      accumulator.inputTokens += json.usage?.input_tokens ?? 0
      accumulator.outputTokens += json.usage?.output_tokens ?? 0
      accumulator.cost = json.cost_usd ?? accumulator.cost
      // 'done' event is emitted by the core after process exit, not by parseLine
```

Note: The `done` event with the full `CliResult` is constructed and emitted by the core stream manager after the process exits, not by the adapter. The adapter just updates the accumulator from the `result` line.

---

## Codex Parser

Raw output format: NDJSON with `type` field.

### Raw types and mapping

| Raw `type` / pattern | Maps to | Notes |
|----------------------|---------|-------|
| `item.started` with `function_call` | `tool_use` | Extract tool name and arguments |
| `item.completed` with `function_call_output` | `tool_result` | |
| `item.completed` with message/text | `text` | |
| Error items | `error` | |
| Summary/usage lines | (accumulator only) | Parse token counts if available |

### Parsing logic

```
for each line:
  json = JSON.parse(line)
  switch json.type:
    'item.started':
      if json.item?.type === 'function_call':
        emit { type: 'tool_use', tool: { name: json.item.name, input: JSON.parse(json.item.arguments ?? '{}') }, raw: line }

    'item.completed':
      if json.item?.type === 'function_call_output':
        emit { type: 'tool_result', toolResult: { name: json.item.call_id, output: json.item.output, error: json.item.status === 'error' ? json.item.output : undefined }, raw: line }
      if json.item?.type === 'message' && json.item.role === 'assistant':
        for each block in (json.item.content ?? []):
          if block.type === 'output_text':
            emit { type: 'text', content: block.text, raw: line }

    'response.completed':
      accumulator.inputTokens += json.response?.usage?.input_tokens ?? 0
      accumulator.outputTokens += json.response?.usage?.output_tokens ?? 0
      // Codex does not report cost or session ID in stream output

    'error':
      emit { type: 'error', content: json.message ?? json.error ?? 'unknown error', raw: line }
```

Note: Codex does not emit session ID or model in its NDJSON stream. `accumulator.sessionId` and `accumulator.model` remain at their initial values (null) unless extracted from transcript metadata in a future Codex version.

---

## OpenCode Parser

Raw output format: JSONL with `type` field that maps almost directly.

### Raw types and mapping

| Raw `type` | Maps to | Notes |
|------------|---------|-------|
| `text` | `text` | Direct mapping |
| `tool_use` | `tool_use` | Direct mapping |
| `tool_result` | `tool_result` | Direct mapping |
| `step_finish` | `system` | Step boundary marker. Extract session ID if present. |
| `error` | `error` | Direct mapping |

### Parsing logic

```
for each line:
  json = JSON.parse(line)
  switch json.type:
    'text':
      emit { type: 'text', content: json.content ?? json.text, raw: line }

    'tool_use':
      emit { type: 'tool_use', tool: { name: json.name, input: json.input ?? {} }, raw: line }

    'tool_result':
      emit { type: 'tool_result', toolResult: { name: json.name, output: json.output, error: json.is_error ? json.output : undefined }, raw: line }

    'step_finish':
      accumulator.sessionId = json.session_id ?? accumulator.sessionId
      accumulator.model = json.model ?? accumulator.model
      accumulator.inputTokens += json.usage?.input_tokens ?? 0
      accumulator.outputTokens += json.usage?.output_tokens ?? 0
      accumulator.cost = json.cost ?? accumulator.cost
      emit { type: 'system', content: 'step_finish', raw: line }

    'error':
      emit { type: 'error', content: json.message ?? json.error ?? 'unknown error', raw: line }
```

---

## Event Timestamp

All events get `timestamp: Date.now()` at the moment `parseLine()` returns them. This is the time the event was parsed, not when the CLI produced it.

---

## Acceptance Criteria

- Given a valid Claude JSONL line with `type: 'assistant'` and a text content block, when `parseLine()` is called, then it returns a `CliEvent` with `type: 'text'` and the text content
- Given a Claude JSONL line with `type: 'assistant'` containing both text and tool_use blocks, when `parseLine()` is called, then it returns two events (one `text`, one `tool_use`)
- Given a Claude JSONL line with `type: 'result'`, when `parseLine()` is called, then the accumulator is updated with session ID, model, and token counts
- Given a line that is not valid JSON, when `parseLine()` is called, then it returns a `system` event with the raw content (never throws)
- Given `verbose: true` and stderr output, when a line is written to stderr, then a `system` event is emitted in real-time
- Given `verbose: false` and stderr output, when a line is written to stderr, then no event is emitted (stderr is buffered for error classification only)
- Given an empty line, when `parseLine()` is called, then it returns an empty array (no events)
