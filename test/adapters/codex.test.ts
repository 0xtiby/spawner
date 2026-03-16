import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { codexAdapter } from '../../src/adapters/codex.js';
import { createAccumulator, type SessionAccumulator } from '../../src/adapters/types.js';

function fixture(name: string): string[] {
  const content = readFileSync(resolve(__dirname, '../fixtures/codex', name), 'utf-8');
  return content.split('\n').filter(line => line !== '');
}

function parseAll(lines: string[], acc: SessionAccumulator) {
  return lines.flatMap(line => codexAdapter.parseLine(line, acc));
}

describe('Codex adapter parseLine (fixture-based)', () => {
  let acc: SessionAccumulator;

  beforeEach(() => {
    acc = createAccumulator();
  });

  describe('text-response.jsonl', () => {
    it('item.completed with assistant text returns text event', () => {
      const lines = fixture('text-response.jsonl');
      const events = parseAll(lines, acc);

      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');
    });

    it('response.completed updates accumulator with token counts', () => {
      const lines = fixture('text-response.jsonl');
      parseAll(lines, acc);

      expect(acc.inputTokens).toBe(50);
      expect(acc.outputTokens).toBe(15);
    });

    it('all events have raw and timestamp fields', () => {
      const lines = fixture('text-response.jsonl');
      const events = parseAll(lines, acc);

      for (const event of events) {
        expect(event.raw).toBeTypeOf('string');
        expect(event.raw.length).toBeGreaterThan(0);
        expect(event.timestamp).toBeTypeOf('number');
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('tool-use.jsonl', () => {
    it('item.started with function_call returns tool_use event with parsed arguments', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[0], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      expect(events[0].tool).toEqual({ name: 'read_file', input: { path: '/src/index.ts' } });
    });

    it('item.started with malformed arguments JSON returns tool_use with fallback empty input', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[2], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      expect(events[0].tool).toEqual({ name: 'write_file', input: {} });
    });

    it('item.completed with function_call_output returns tool_result event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[1], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult).toEqual({
        name: 'call-123',
        output: 'export function main() {}',
        error: undefined,
      });
    });

    it('item.completed with assistant text returns text event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[3], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Done! I read the file.');
    });

    it('response.completed updates accumulator token counts', () => {
      const lines = fixture('tool-use.jsonl');
      parseAll(lines, acc);

      expect(acc.inputTokens).toBe(200);
      expect(acc.outputTokens).toBe(40);
    });
  });

  describe('error-auth.jsonl', () => {
    it('error type returns error event with message', () => {
      const lines = fixture('error-auth.jsonl');
      const events = parseAll(lines, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].content).toBe('Authentication failed: invalid API key');
    });
  });

  describe('edge cases', () => {
    it('invalid JSON returns system event (never throws)', () => {
      const events = codexAdapter.parseLine('this is not json {{{', acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('system');
      expect(events[0].content).toBe('this is not json {{{');
      expect(events[0].raw).toBe('this is not json {{{');
    });

    it('empty line returns empty array', () => {
      expect(codexAdapter.parseLine('', acc)).toEqual([]);
    });

    it('whitespace-only line returns empty array', () => {
      expect(codexAdapter.parseLine('   \t  ', acc)).toEqual([]);
    });

    it('unrecognized type falls through as system event', () => {
      const line = '{"type":"some.unknown.event","data":"test"}';
      const events = codexAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('system');
      expect(events[0].raw).toBe(line);
    });

    it('item.completed with function_call_output error status includes error field', () => {
      const line = '{"type":"item.completed","item":{"type":"function_call_output","call_id":"call-err","output":"permission denied","status":"error"}}';
      const events = codexAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult!.error).toBe('permission denied');
    });

    it('item.started with non-function_call type returns empty array', () => {
      const line = '{"type":"item.started","item":{"type":"message","role":"user"}}';
      const events = codexAdapter.parseLine(line, acc);

      expect(events).toEqual([]);
    });

    it('response.completed accumulates across multiple responses', () => {
      codexAdapter.parseLine('{"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5}}}', acc);
      codexAdapter.parseLine('{"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":10}}}', acc);

      expect(acc.inputTokens).toBe(30);
      expect(acc.outputTokens).toBe(15);
    });
  });
});
