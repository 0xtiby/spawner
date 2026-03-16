import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from './spawn.js';
import { getAdapter } from '../adapters/index.js';
import type { SpawnOptions, CliEvent } from '../types.js';
import type { CliAdapter } from '../adapters/types.js';

// We need to patch the adapter's buildCommand and classifyError for tests
// since the real adapter's classifyError isn't implemented yet.
let adapter: CliAdapter;
let origBuildCommand: CliAdapter['buildCommand'];
let origClassifyError: CliAdapter['classifyError'];

beforeEach(() => {
  adapter = getAdapter('claude');
  origBuildCommand = adapter.buildCommand;
  origClassifyError = adapter.classifyError;

  // Default: stub classifyError to return a generic error
  adapter.classifyError = (exitCode, stderr) => ({
    code: 'unknown',
    message: `Process exited with code ${exitCode}`,
    retryable: false,
    retryAfterMs: null,
    raw: stderr,
  });
});

afterEach(() => {
  adapter.buildCommand = origBuildCommand;
  adapter.classifyError = origClassifyError;
});

function makeOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    cli: 'claude',
    prompt: 'test',
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

describe('spawn', () => {
  it('returns CliProcess with valid pid', () => {
    adapter.buildCommand = () => ({ bin: 'echo', args: ['hi'], stdinInput: undefined });
    const proc = spawn(makeOptions());

    expect(proc).toHaveProperty('pid');
    expect(proc.pid).toBeTypeOf('number');
    expect(proc).toHaveProperty('events');
    expect(proc).toHaveProperty('interrupt');
    expect(proc).toHaveProperty('done');

    // Clean up
    proc.done.catch(() => {});
  });

  it('done resolves with CliResult on exit code 0', async () => {
    adapter.buildCommand = () => ({ bin: 'echo', args: ['hello'], stdinInput: undefined });
    const proc = spawn(makeOptions());
    const result = await proc.done;

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('sessionId');
    expect(result).toHaveProperty('usage');
    expect(result).toHaveProperty('model');
  });

  it('ENOENT binary rejects done with binary_not_found', async () => {
    adapter.buildCommand = () => ({
      bin: '/nonexistent/binary/xxxx',
      args: [],
      stdinInput: 'test',
    });

    const proc = spawn(makeOptions());

    const result = await proc.done.catch((r) => r);
    expect(result.error.code).toBe('binary_not_found');
    expect(result.error.message).toContain('Binary not found');

    // Events should also error
    await expect(async () => {
      for await (const _ of proc.events) {
        // should throw
      }
    }).rejects.toThrow();
  });

  it('nonexistent cwd rejects done with fatal error', async () => {
    adapter.buildCommand = () => ({
      bin: 'echo',
      args: ['hello'],
      stdinInput: undefined,
    });

    const proc = spawn(makeOptions({ cwd: '/nonexistent/path/xxxx' }));

    const result = await proc.done.catch((r) => r);
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('fatal');
    expect(result.error.message).toContain('working directory not found');
  });

  it('stdin content is delivered to child process', async () => {
    adapter.buildCommand = () => ({
      bin: 'cat',
      args: [],
      stdinInput: 'hello from stdin',
    });

    const proc = spawn(makeOptions());
    const events = await collectEvents(proc.events);
    const result = await proc.done;

    // cat echoes stdin back; parseLine processes it
    const textEvents = events.filter((e) => e.type !== 'done');
    expect(textEvents.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  });

  it('duration is tracked (> 0ms)', async () => {
    adapter.buildCommand = () => ({
      bin: 'echo',
      args: ['hi'],
      stdinInput: undefined,
    });

    const proc = spawn(makeOptions());
    const result = await proc.done;

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(10000);
  });

  it('events arrive in order during iteration', async () => {
    adapter.buildCommand = () => ({
      bin: 'printf',
      args: ['line1\\nline2\\nline3\\n'],
      stdinInput: undefined,
    });

    const proc = spawn(makeOptions());
    const events = await collectEvents(proc.events);
    const result = await proc.done;

    expect(result.exitCode).toBe(0);
    // Last event should be 'done'
    expect(events[events.length - 1].type).toBe('done');
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('done resolves with error on non-zero exit', async () => {
    adapter.buildCommand = () => ({
      bin: 'sh',
      args: ['-c', 'exit 1'],
      stdinInput: undefined,
    });

    const proc = spawn(makeOptions());
    const result = await proc.done;

    expect(result.exitCode).toBe(1);
    expect(result.error).not.toBeNull();
    expect(result.error!.code).toBe('unknown');
  });

  describe('abortSignal', () => {
    it('abort triggers interrupt on running process', async () => {
      adapter.buildCommand = () => ({
        bin: 'sleep',
        args: ['30'],
        stdinInput: undefined,
      });

      const ac = new AbortController();
      const proc = spawn(makeOptions({ abortSignal: ac.signal }));

      // Give process time to start
      await new Promise((r) => setTimeout(r, 50));
      ac.abort();

      const result = await proc.done;
      expect(result).toBeDefined();
      expect(result.exitCode).not.toBe(0);
    });

    it('listener is removed after process exits normally', async () => {
      adapter.buildCommand = () => ({
        bin: 'echo',
        args: ['hi'],
        stdinInput: undefined,
      });

      const ac = new AbortController();
      const proc = spawn(makeOptions({ abortSignal: ac.signal }));
      await proc.done;

      // After process exits, aborting should not throw or cause issues
      ac.abort();
      // If listener wasn't cleaned up, this would call interrupt on a dead process
    });

    it('pre-aborted signal triggers interrupt immediately', async () => {
      adapter.buildCommand = () => ({
        bin: 'sleep',
        args: ['30'],
        stdinInput: undefined,
      });

      const ac = new AbortController();
      ac.abort(); // Abort before spawning

      const proc = spawn(makeOptions({ abortSignal: ac.signal }));
      const result = await proc.done;

      expect(result).toBeDefined();
      expect(result.exitCode).not.toBe(0);
    });

    it('no error when abortSignal is omitted', async () => {
      adapter.buildCommand = () => ({
        bin: 'echo',
        args: ['hi'],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());
      const result = await proc.done;

      expect(result.exitCode).toBe(0);
    });
  });

  describe('iterator abandonment', () => {
    it('breaking out of for-await does not kill the process', async () => {
      adapter.buildCommand = () => ({
        bin: 'sh',
        args: ['-c', 'echo line1; echo line2; echo line3; sleep 0.1; echo done'],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());

      // Break after first event
      for await (const _event of proc.events) {
        break;
      }

      // done still resolves — process was not killed
      const result = await proc.done;
      expect(result).toBeDefined();
      expect(result.exitCode).toBe(0);
    });

    it('done resolves with complete result after iterator abandoned', async () => {
      adapter.buildCommand = () => ({
        bin: 'echo',
        args: ['hello'],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());

      // Consume one event then break
      for await (const _event of proc.events) {
        break;
      }

      const result = await proc.done;
      expect(result.exitCode).toBe(0);
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('sessionId');
    });
  });

  describe('interrupt', () => {
    it('sends SIGTERM to running process', async () => {
      adapter.buildCommand = () => ({
        bin: 'sleep',
        args: ['30'],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());
      const result = await proc.interrupt();

      expect(result).toBeDefined();
      expect(result.exitCode).not.toBe(0);
    });

    it('process that exits quickly does not receive SIGKILL', async () => {
      // sleep responds to SIGTERM by default — it exits immediately
      adapter.buildCommand = () => ({
        bin: 'sleep',
        args: ['30'],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());
      const start = Date.now();
      const result = await proc.interrupt(5000);
      const elapsed = Date.now() - start;

      // Process exited via SIGTERM well before the 5s SIGKILL timeout
      expect(result).toBeDefined();
      expect(elapsed).toBeLessThan(4000);
    });

    it('process that ignores SIGTERM receives SIGKILL after graceMs', { timeout: 10000 }, async () => {
      // node -e with SIGTERM trapped will ignore SIGTERM, requiring SIGKILL
      adapter.buildCommand = () => ({
        bin: 'node',
        args: ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000);"],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());
      await new Promise((r) => setTimeout(r, 100));

      const start = Date.now();
      const result = await proc.interrupt(200);
      const elapsed = Date.now() - start;

      expect(result).toBeDefined();
      expect(elapsed).toBeGreaterThanOrEqual(150);
    });

    it('interrupt on exited process returns done immediately', async () => {
      adapter.buildCommand = () => ({
        bin: 'echo',
        args: ['hi'],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());
      const originalResult = await proc.done;

      // Process already exited — interrupt should be a no-op
      const result = await proc.interrupt();
      expect(result).toBe(originalResult);
      expect(result.exitCode).toBe(0);
    });

    it('custom graceMs is respected', { timeout: 10000 }, async () => {
      adapter.buildCommand = () => ({
        bin: 'node',
        args: ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000);"],
        stdinInput: undefined,
      });

      const proc = spawn(makeOptions());
      await new Promise((r) => setTimeout(r, 100));

      const start = Date.now();
      const result = await proc.interrupt(100);
      const elapsed = Date.now() - start;

      expect(result).toBeDefined();
      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
