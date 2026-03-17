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
    it('thread.started captures thread_id as sessionId', () => {
      const lines = fixture('text-response.jsonl');
      codexAdapter.parseLine(lines[0], acc);

      expect(acc.sessionId).toBe('019cfb9b-a457-73e0-9514-673706447f49');
    });

    it('agent_message returns text event', () => {
      const lines = fixture('text-response.jsonl');
      const events = parseAll(lines, acc);

      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');
    });

    it('turn.completed updates accumulator with token counts', () => {
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
    it('item.started with command_execution returns tool_use event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[2], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      expect(events[0].tool).toEqual({ name: 'command_execution', input: { command: "/bin/zsh -lc 'cat /src/index.ts'" } });
    });

    it('item.completed with command_execution returns tool_result event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[3], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult).toEqual({
        name: 'command_execution',
        output: 'export function main() {}',
        error: undefined,
      });
    });

    it('agent_message returns text event', () => {
      const lines = fixture('tool-use.jsonl');
      const events = codexAdapter.parseLine(lines[4], acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Done! I read the file.');
    });

    it('turn.completed updates accumulator token counts', () => {
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

    it('command_execution with non-zero exit includes error field', () => {
      const line = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'rm -rf /', aggregated_output: 'permission denied', exit_code: 1, status: 'completed' } });
      const events = codexAdapter.parseLine(line, acc);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult!.error).toBe('permission denied');
    });

    it('reasoning items are silently skipped', () => {
      const line = JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking...' } });
      const events = codexAdapter.parseLine(line, acc);

      expect(events).toEqual([]);
    });

    it('turn.completed accumulates across multiple turns', () => {
      codexAdapter.parseLine('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}', acc);
      codexAdapter.parseLine('{"type":"turn.completed","usage":{"input_tokens":20,"output_tokens":10}}', acc);

      expect(acc.inputTokens).toBe(30);
      expect(acc.outputTokens).toBe(15);
    });
  });
});
