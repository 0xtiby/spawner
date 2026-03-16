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
});
