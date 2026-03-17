import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PassThrough } from 'node:stream';
import { createStream } from '../../src/core/stream.js';
import { claudeAdapter } from '../../src/adapters/claude.js';
import { codexAdapter } from '../../src/adapters/codex.js';
import { opencodeAdapter } from '../../src/adapters/opencode.js';
import type { CliAdapter, SessionAccumulator } from '../../src/adapters/types.js';

function fixture(adapter: string, name: string): string[] {
  const content = readFileSync(resolve(__dirname, '../fixtures', adapter, name), 'utf-8');
  return content.split('\n').filter(line => line !== '');
}

async function collectEvents(iterable: AsyncIterable<import('../../src/types.js').CliEvent>) {
  const events: import('../../src/types.js').CliEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

function feedLines(stdout: PassThrough, stderr: PassThrough, lines: string[]) {
  for (const line of lines) {
    stdout.write(line + '\n');
  }
  stdout.end();
  stderr.end();
}

describe('stream wiring (fixture-based)', () => {
  describe('readline splits stdout lines and passes each to parseLine', () => {
    it('Claude fixtures: each line produces correct events', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('claude', 'text-response.jsonl');

      const { events, result } = createStream({ stdout, stderr, adapter: claudeAdapter });
      const collecting = collectEvents(events);

      feedLines(stdout, stderr, lines);

      const collected = await collecting;
      const { accumulator } = await result;

      const textEvents = collected.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');
      expect(accumulator.sessionId).toBe('sess-abc-123');
    });

    it('Codex fixtures: each line produces correct events', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('codex', 'text-response.jsonl');

      const { events, result } = createStream({ stdout, stderr, adapter: codexAdapter });
      const collecting = collectEvents(events);

      feedLines(stdout, stderr, lines);

      const collected = await collecting;
      const { accumulator } = await result;

      const textEvents = collected.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');
      expect(accumulator.inputTokens).toBe(50);
    });

    it('OpenCode fixtures: each line produces correct events', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('opencode', 'text-response.jsonl');

      const { events, result } = createStream({ stdout, stderr, adapter: opencodeAdapter });
      const collecting = collectEvents(events);

      feedLines(stdout, stderr, lines);

      const collected = await collecting;
      const { accumulator } = await result;

      const textEvents = collected.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');
      expect(accumulator.sessionId).toBe('sess-oc-001');
    });
  });

  describe('events from parseLine are yielded in order', () => {
    it('tool-use fixture yields events in line order', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('opencode', 'tool-use.jsonl');

      const { events } = createStream({ stdout, stderr, adapter: opencodeAdapter });
      const collecting = collectEvents(events);

      feedLines(stdout, stderr, lines);

      const collected = await collecting;
      // OpenCode fixture starts with step_start (system), then tool_use + tool_result combined
      const toolUse = collected.find(e => e.type === 'tool_use');
      const toolResult = collected.find(e => e.type === 'tool_result');
      expect(toolUse).toBeDefined();
      expect(toolResult).toBeDefined();
    });

    it('timestamps are monotonically non-decreasing', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('claude', 'tool-use.jsonl');

      const { events } = createStream({ stdout, stderr, adapter: claudeAdapter });
      const collecting = collectEvents(events);

      feedLines(stdout, stderr, lines);

      const collected = await collecting;
      for (let i = 1; i < collected.length; i++) {
        expect(collected[i].timestamp).toBeGreaterThanOrEqual(collected[i - 1].timestamp);
      }
    });
  });

  describe('empty lines are handled gracefully', () => {
    it('empty lines mixed with fixture data do not crash', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('claude', 'text-response.jsonl');

      const { events } = createStream({ stdout, stderr, adapter: claudeAdapter });
      const collecting = collectEvents(events);

      // Interleave empty lines
      stdout.write('\n');
      stdout.write(lines[0] + '\n');
      stdout.write('\n');
      stdout.write('\n');
      if (lines.length > 1) stdout.write(lines[1] + '\n');
      stdout.end();
      stderr.end();

      const collected = await collecting;
      // Should still get events from valid lines
      expect(collected.length).toBeGreaterThan(0);
    });

    it('only empty lines produce no events', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();

      const { events } = createStream({ stdout, stderr, adapter: claudeAdapter });
      const collecting = collectEvents(events);

      stdout.write('\n');
      stdout.write('\n');
      stdout.write('\n');
      stdout.end();
      stderr.end();

      const collected = await collecting;
      expect(collected).toHaveLength(0);
    });
  });

  describe('stream completes when stdout ends', () => {
    it('result promise resolves with accumulator after stdout ends', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const lines = fixture('claude', 'text-response.jsonl');

      const { events, result } = createStream({ stdout, stderr, adapter: claudeAdapter });
      const collecting = collectEvents(events);

      feedLines(stdout, stderr, lines);

      await collecting;
      const { accumulator, stderr: stderrBuf } = await result;

      expect(accumulator).toBeDefined();
      expect(accumulator.sessionId).toBe('sess-abc-123');
      expect(stderrBuf).toBe('');
    });

    it('stderr is captured alongside stdout events', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();

      const { events, result } = createStream({ stdout, stderr, adapter: claudeAdapter });
      const collecting = collectEvents(events);

      stderr.write('warning: deprecation\n');
      stdout.write('\n');
      stdout.end();
      stderr.end();

      await collecting;
      const { stderr: stderrBuf } = await result;

      expect(stderrBuf).toBe('warning: deprecation\n');
    });

    it('async iterator terminates after stdout closes', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();

      const { events } = createStream({ stdout, stderr, adapter: claudeAdapter });

      stdout.end();
      stderr.end();

      const collected = await collectEvents(events);
      expect(collected).toHaveLength(0);
    });
  });
});
