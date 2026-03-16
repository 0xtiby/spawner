import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { opencodeAdapter } from '../../src/adapters/opencode.js';
import { createAccumulator, type SessionAccumulator } from '../../src/adapters/types.js';

function fixture(name: string): string[] {
  const content = readFileSync(resolve(__dirname, '../fixtures/opencode', name), 'utf-8');
  return content.split('\n').filter(line => line !== '');
}

function parseAll(lines: string[], acc: SessionAccumulator) {
  return lines.flatMap(line => opencodeAdapter.parseLine(line, acc));
}

describe('OpenCode adapter parseLine (fixture-based)', () => {
  let acc: SessionAccumulator;

  beforeEach(() => {
    acc = createAccumulator();
  });

  describe('text-response.jsonl', () => {
    it('text type returns text event with correct content', () => {
      const lines = fixture('text-response.jsonl');
      const events = opencodeAdapter.parseLine(lines[0], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Hello! How can I help you today?');
    });

    it('step_finish updates accumulator with session info and tokens', () => {
      const lines = fixture('text-response.jsonl');
      parseAll(lines, acc);

      expect(acc.sessionId).toBe('sess-oc-001');
      expect(acc.model).toBe('gpt-4o');
      expect(acc.inputTokens).toBe(30);
      expect(acc.outputTokens).toBe(10);
      expect(acc.cost).toBe(0.0005);
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
    it('tool_use type returns tool_use event with name and input', () => {
      const lines = fixture('tool-use.jsonl');
      const events = opencodeAdapter.parseLine(lines[0], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      expect(events[0].tool).toEqual({ name: 'read_file', input: { path: '/src/index.ts' } });
    });

    it('tool_result type returns tool_result event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = opencodeAdapter.parseLine(lines[1], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult).toEqual({
        name: 'read_file',
        output: 'export function main() {}',
        error: undefined,
      });
    });

    it('tool_result with is_error=true includes error field', () => {
      const lines = fixture('tool-use.jsonl');
      const events = opencodeAdapter.parseLine(lines[2], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult).toEqual({
        name: 'write_file',
        output: 'permission denied',
        error: 'permission denied',
      });
    });

    it('text event after tool results parses correctly', () => {
      const lines = fixture('tool-use.jsonl');
      const events = opencodeAdapter.parseLine(lines[3], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('I read the file for you.');
    });

    it('step_finish updates accumulator token counts', () => {
      const lines = fixture('tool-use.jsonl');
      parseAll(lines, acc);

      expect(acc.inputTokens).toBe(100);
      expect(acc.outputTokens).toBe(25);
    });
  });

  describe('step-finish.jsonl', () => {
    it('step_finish emits system event', () => {
      const lines = fixture('step-finish.jsonl');
      const events = parseAll(lines, acc);

      const systemEvents = events.filter(e => e.type === 'system');
      expect(systemEvents).toHaveLength(2);
      expect(systemEvents[0].content).toBe('step_finish');
    });

    it('multiple step_finish lines accumulate token counts', () => {
      const lines = fixture('step-finish.jsonl');
      parseAll(lines, acc);

      expect(acc.inputTokens).toBe(80);
      expect(acc.outputTokens).toBe(30);
    });

    it('last step_finish cost overwrites previous', () => {
      const lines = fixture('step-finish.jsonl');
      parseAll(lines, acc);

      expect(acc.cost).toBe(0.0015);
    });

    it('accumulator captures session and model from step_finish', () => {
      const lines = fixture('step-finish.jsonl');
      parseAll(lines, acc);

      expect(acc.sessionId).toBe('sess-oc-step');
      expect(acc.model).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('error handling', () => {
    it('error type returns error event with message', () => {
      const line = '{"type":"error","message":"Rate limit exceeded"}';
      const events = opencodeAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].content).toBe('Rate limit exceeded');
    });

    it('error type with error field falls back correctly', () => {
      const line = '{"type":"error","error":"Authentication failed"}';
      const events = opencodeAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].content).toBe('Authentication failed');
    });
  });

  describe('edge cases', () => {
    it('invalid JSON returns system event (never throws)', () => {
      const events = opencodeAdapter.parseLine('this is not json {{{', acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('system');
      expect(events[0].content).toBe('this is not json {{{');
      expect(events[0].raw).toBe('this is not json {{{');
    });

    it('empty line returns empty array', () => {
      expect(opencodeAdapter.parseLine('', acc)).toEqual([]);
    });

    it('whitespace-only line returns empty array', () => {
      expect(opencodeAdapter.parseLine('   \t  ', acc)).toEqual([]);
    });

    it('unrecognized type falls through as system event', () => {
      const line = '{"type":"some.unknown.event","data":"test"}';
      const events = opencodeAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('system');
      expect(events[0].raw).toBe(line);
    });

    it('text type with text field instead of content parses correctly', () => {
      const line = '{"type":"text","text":"Fallback text field"}';
      const events = opencodeAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Fallback text field');
    });

    it('step_finish without usage does not corrupt accumulator', () => {
      const line = '{"type":"step_finish","session_id":"sess-no-usage"}';
      opencodeAdapter.parseLine(line, acc);

      expect(acc.sessionId).toBe('sess-no-usage');
      expect(acc.inputTokens).toBe(0);
      expect(acc.outputTokens).toBe(0);
    });
  });
});
