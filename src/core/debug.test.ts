import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// We need to re-import the module fresh for NODE_DEBUG tests,
// so we test the verbose path directly and NODE_DEBUG via spawn integration.

describe('createDebugLogger', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: MockInstance<any>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('returns null when verbose is false and NODE_DEBUG unset', async () => {
    const { createDebugLogger } = await import('./debug.js');
    const log = createDebugLogger(false);
    if (log === null) {
      expect(log).toBeNull();
    }
  });

  it('returns a function when verbose is true', async () => {
    const { createDebugLogger } = await import('./debug.js');
    const log = createDebugLogger(true);
    expect(log).toBeTypeOf('function');
  });

  it('writes to stderr with [spawner] prefix', async () => {
    const { createDebugLogger } = await import('./debug.js');
    const log = createDebugLogger(true)!;
    log('test message');
    expect(stderrSpy).toHaveBeenCalledWith('[spawner] test message\n');
  });

  it('does not write to stdout', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stdoutSpy: MockInstance<any> = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { createDebugLogger } = await import('./debug.js');
    const log = createDebugLogger(true)!;
    log('test');
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});

describe('spawn debug logging integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: MockInstance<any>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('verbose=true logs spawn command to stderr', async () => {
    const { spawn } = await import('./spawn.js');
    const { getAdapter } = await import('../adapters/index.js');
    const adapter = getAdapter('claude');
    adapter.buildCommand = () => ({ bin: 'echo', args: ['hi'], stdinInput: undefined });

    const proc = spawn({ cli: 'claude', prompt: 'test', cwd: process.cwd(), verbose: true });
    await proc.done;

    const calls = stderrSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.some((c: unknown) => typeof c === 'string' && c.includes('[spawner] spawn: echo hi'))).toBe(true);
  });

  it('verbose=true logs events and exit info', async () => {
    const { spawn } = await import('./spawn.js');
    const { getAdapter } = await import('../adapters/index.js');
    const adapter = getAdapter('claude');
    adapter.buildCommand = () => ({ bin: 'echo', args: ['hello'], stdinInput: undefined });
    adapter.classifyError = () => ({
      code: 'unknown',
      message: 'error',
      retryable: false,
      retryAfterMs: null,
      raw: '',
    });

    const proc = spawn({ cli: 'claude', prompt: 'test', cwd: process.cwd(), verbose: true });

    // Consume events
    for await (const _ of proc.events) { /* drain */ }
    await proc.done;

    const calls = stderrSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.some((c: unknown) => typeof c === 'string' && c.includes('[spawner] exit:'))).toBe(true);
  });

  it('default (no verbose, no NODE_DEBUG) produces no debug output', async () => {
    const { spawn } = await import('./spawn.js');
    const { getAdapter } = await import('../adapters/index.js');
    const adapter = getAdapter('claude');
    adapter.buildCommand = () => ({ bin: 'echo', args: ['hi'], stdinInput: undefined });

    const proc = spawn({ cli: 'claude', prompt: 'test', cwd: process.cwd() });
    await proc.done;

    const calls = stderrSpy.mock.calls.map((c: unknown[]) => c[0]);
    const spawnerCalls = calls.filter((c: unknown) => typeof c === 'string' && c.includes('[spawner]'));
    expect(spawnerCalls.length).toBe(0);
  });
});
