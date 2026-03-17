import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { claudeAdapter } from '../../src/adapters/claude.js';
import { createAccumulator, type SessionAccumulator } from '../../src/adapters/types.js';

function fixture(name: string): string[] {
  const content = readFileSync(resolve(__dirname, '../fixtures/claude', name), 'utf-8');
  return content.split('\n').filter(line => line !== '');
}

function parseAll(lines: string[], acc: SessionAccumulator) {
  return lines.flatMap(line => claudeAdapter.parseLine(line, acc));
}

describe('Claude adapter parseLine (fixture-based)', () => {
  let acc: SessionAccumulator;

  beforeEach(() => {
    acc = createAccumulator();
  });

  describe('text-response.jsonl', () => {
    it('system line updates accumulator and returns system event', () => {
      const lines = fixture('text-response.jsonl');
      const events = claudeAdapter.parseLine(lines[0], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('system');
      expect(acc.sessionId).toBe('sess-abc-123');
      expect(acc.model).toBe('claude-sonnet-4-20250514');
    });

    it('assistant text block returns text event with correct content', () => {
      const lines = fixture('text-response.jsonl');
      const events = parseAll(lines, acc);

      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');
    });

    it('result line updates all accumulator fields', () => {
      const lines = fixture('text-response.jsonl');
      parseAll(lines, acc);

      expect(acc.sessionId).toBe('sess-abc-123');
      expect(acc.model).toBe('claude-sonnet-4-20250514');
      expect(acc.inputTokens).toBe(42);
      expect(acc.outputTokens).toBe(12);
      expect(acc.cost).toBe(0.0003);
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
    it('assistant tool_use block returns tool_use event with name and input', () => {
      const lines = fixture('tool-use.jsonl');
      const events = parseAll(lines, acc);

      const toolUseEvents = events.filter(e => e.type === 'tool_use');
      expect(toolUseEvents).toHaveLength(1);
      expect(toolUseEvents[0].tool).toEqual({ name: 'read_file', input: { path: '/src/index.ts' } });
    });

    it('assistant tool_result block returns tool_result event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = parseAll(lines, acc);

      const toolResultEvents = events.filter(e => e.type === 'tool_result');
      expect(toolResultEvents).toHaveLength(1);
      expect(toolResultEvents[0].toolResult).toEqual({
        name: 'read_file',
        output: 'export function main() {}',
        error: undefined,
      });
    });

    it('assistant with multiple blocks returns multiple events', () => {
      const lines = fixture('tool-use.jsonl');
      // Line 1 (index 1) has both text and tool_use blocks
      const events = claudeAdapter.parseLine(lines[1], acc);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Let me read that file for you.');
      expect(events[1].type).toBe('tool_use');
      expect(events[1].tool!.name).toBe('read_file');
    });
  });

  describe('session-resume.jsonl', () => {
    it('resumed session updates accumulator with new session ID and model', () => {
      const lines = fixture('session-resume.jsonl');
      parseAll(lines, acc);

      expect(acc.sessionId).toBe('sess-resumed-789');
      expect(acc.model).toBe('claude-opus-4-20250514');
      expect(acc.inputTokens).toBe(500);
      expect(acc.outputTokens).toBe(25);
      expect(acc.cost).toBe(0.008);
    });
  });

  describe('error-rate-limit.jsonl', () => {
    it('unrecognized error type falls through as system event', () => {
      const lines = fixture('error-rate-limit.jsonl');
      const events = parseAll(lines, acc);

      // The error line has type: "error" which is unrecognized by Claude parser → system event
      const systemEvents = events.filter(e => e.type === 'system');
      expect(systemEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('accumulator still captures session info from system line', () => {
      const lines = fixture('error-rate-limit.jsonl');
      parseAll(lines, acc);

      expect(acc.sessionId).toBe('sess-rl-001');
      expect(acc.model).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('malformed.jsonl', () => {
    it('invalid JSON returns system event (never throws)', () => {
      const lines = fixture('malformed.jsonl');

      // Should not throw
      const events = parseAll(lines, acc);

      // Malformed lines (indices 1, 3) become system events
      const systemEvents = events.filter(e => e.type === 'system');
      // At least 3 system events: 1 from system line + 2 from malformed lines
      expect(systemEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('valid lines still parse correctly alongside malformed ones', () => {
      const lines = fixture('malformed.jsonl');
      const events = parseAll(lines, acc);

      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Valid line after malformed one.');
    });

    it('accumulator is updated from valid lines despite malformed ones', () => {
      const lines = fixture('malformed.jsonl');
      parseAll(lines, acc);

      expect(acc.sessionId).toBe('sess-mal-001');
      expect(acc.inputTokens).toBe(10);
      expect(acc.outputTokens).toBe(5);
    });
  });

  describe('empty line handling', () => {
    it('empty line returns empty array', () => {
      expect(claudeAdapter.parseLine('', acc)).toEqual([]);
    });

    it('whitespace-only line returns empty array', () => {
      expect(claudeAdapter.parseLine('   \t  ', acc)).toEqual([]);
    });
  });
});
