import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createMockProcess, type MockChildProcess } from '../helpers/mock-process.js';
import type { CliEvent, SpawnOptions } from '../../src/types.js';

// Track the most recently created mock process for assertions
let mockProc: MockChildProcess;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

// Must import spawn AFTER the mock is registered
const { spawn } = await import('../../src/core/spawn.js');

function fixture(adapter: string, name: string): string[] {
  const content = readFileSync(resolve(__dirname, '../fixtures', adapter, name), 'utf-8');
  return content.split('\n').filter(line => line !== '');
}

function makeOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    cli: 'claude',
    prompt: 'test prompt',
    cwd: process.cwd(),
    ...overrides,
  };
}

async function collectEvents(iterable: AsyncIterable<CliEvent>): Promise<CliEvent[]> {
  const events: CliEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('spawn (mocked child_process)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path', () => {
    it('feeds text JSONL, exit 0 — events arrive in order, done resolves with CliResult', async () => {
      const lines = fixture('claude', 'text-response.jsonl');
      mockProc = createMockProcess({ stdoutLines: lines, exitCode: 0 });

      const proc = spawn(makeOptions());
      const events = await collectEvents(proc.events);
      const result = await proc.done;

      // Events should include system, text, and done
      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].content).toBe('Hello! How can I help you today?');

      const doneEvents = events.filter(e => e.type === 'done');
      expect(doneEvents).toHaveLength(1);

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.sessionId).toBe('sess-abc-123');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.usage).toEqual({
        inputTokens: 42,
        outputTokens: 12,
        totalTokens: 54,
        cost: 0.0003,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('events arrive in order matching fixture line order', async () => {
      const lines = fixture('claude', 'tool-use.jsonl');
      mockProc = createMockProcess({ stdoutLines: lines, exitCode: 0 });

      const proc = spawn(makeOptions());
      const events = await collectEvents(proc.events);
      const result = await proc.done;

      // Filter non-done events
      const contentEvents = events.filter(e => e.type !== 'done');

      // First event from system line
      expect(contentEvents[0].type).toBe('system');
      // Second line has text + tool_use
      expect(contentEvents[1].type).toBe('text');
      expect(contentEvents[2].type).toBe('tool_use');

      expect(result.exitCode).toBe(0);
    });
  });

  describe('ENOENT', () => {
    it('mock emits error code ENOENT — done rejects with binary_not_found', async () => {
      // Create a mock that emits ENOENT error instead of normal output
      const { EventEmitter } = await import('node:events');
      const { PassThrough } = await import('node:stream');

      const proc = new EventEmitter() as MockChildProcess;
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.stdin = new PassThrough();
      proc.pid = 99999;
      proc.killed = false;
      proc.kill = () => { proc.killed = true; return true; };

      mockProc = proc;

      // Emit ENOENT error after a microtask (simulates real spawn failure)
      setImmediate(() => {
        const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        proc.stdout.end();
        proc.stderr.end();
        proc.emit('error', err);
      });

      const cliProc = spawn(makeOptions());

      const result = await cliProc.done.catch((r: unknown) => r);
      expect(result).toHaveProperty('error');
      expect((result as any).error.code).toBe('binary_not_found');
      expect((result as any).error.message).toContain('Binary not found');
    });
  });

  describe('non-zero exit', () => {
    it('feed output, exit 1 + stderr — CliResult.error populated', async () => {
      const lines = fixture('claude', 'text-response.jsonl');
      mockProc = createMockProcess({
        stdoutLines: lines,
        stderrLines: ['Error: something went wrong'],
        exitCode: 1,
      });

      const proc = spawn(makeOptions());
      const events = await collectEvents(proc.events);
      const result = await proc.done;

      expect(result.exitCode).toBe(1);
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBeDefined();

      // Done event should still arrive
      const doneEvents = events.filter(e => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    });
  });

  describe('interrupt', () => {
    it('call interrupt() — SIGTERM sent, done resolves', async () => {
      mockProc = createMockProcess({
        stdoutLines: ['{"type":"text","content":"slow line"}'],
        exitCode: 0,
        delay: 500,
      });

      const proc = spawn(makeOptions());

      // Let process start, then interrupt
      await new Promise(r => setTimeout(r, 20));
      const result = await proc.interrupt();

      expect(result).toBeDefined();
      expect(mockProc.killed).toBe(true);
    });
  });

  describe('AbortSignal', () => {
    it('abort signal triggers interrupt on running process', async () => {
      mockProc = createMockProcess({
        stdoutLines: ['{"type":"text","content":"waiting"}'],
        exitCode: 0,
        delay: 500,
      });

      const ac = new AbortController();
      const proc = spawn(makeOptions({ abortSignal: ac.signal }));

      // Give it time to start, then abort
      await new Promise(r => setTimeout(r, 20));
      ac.abort();

      const result = await proc.done;
      expect(result).toBeDefined();
      expect(mockProc.killed).toBe(true);
    });
  });

  describe('stdin delivery', () => {
    it('options with prompt — stdin.write called with prompt, stdin.end called', async () => {
      mockProc = createMockProcess({ stdoutLines: [], exitCode: 0 });

      const writeSpy = vi.spyOn(mockProc.stdin, 'write');
      const endSpy = vi.spyOn(mockProc.stdin, 'end');

      const proc = spawn(makeOptions({ prompt: 'hello world' }));
      await proc.done;

      expect(writeSpy).toHaveBeenCalledWith('hello world');
      expect(endSpy).toHaveBeenCalled();
    });
  });
});
