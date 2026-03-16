import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { spawn } from './spawn.js';
import { getAdapter } from '../adapters/index.js';
import type { SpawnOptions, CliEvent } from '../types.js';
import type { CliAdapter } from '../adapters/types.js';

const MOCK_CLI = resolve(import.meta.dirname, '__fixtures__/mock-cli.js');

// Patch adapter to point at mock CLI binary
let adapter: CliAdapter;
let origBuildCommand: CliAdapter['buildCommand'];
let origClassifyError: CliAdapter['classifyError'];

beforeEach(() => {
  adapter = getAdapter('claude');
  origBuildCommand = adapter.buildCommand;
  origClassifyError = adapter.classifyError;

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

function mockCommand(...extraArgs: string[]) {
  return { bin: 'node', args: [MOCK_CLI, ...extraArgs], stdinInput: 'hello world' };
}

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

describe('spawn integration', () => {
  it('spawns mock CLI and receives events in order via for-await', async () => {
    adapter.buildCommand = () => mockCommand();
    const proc = spawn(makeOptions());

    const events = await collectEvents(proc.events);
    const result = await proc.done;

    // System event first, then text, then done
    const types = events.map((e) => e.type);
    expect(types).toContain('system');
    expect(types).toContain('text');
    expect(types[types.length - 1]).toBe('done');

    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('done resolves with correct exitCode and durationMs', async () => {
    adapter.buildCommand = () => mockCommand();
    const proc = spawn(makeOptions());

    const result = await proc.done;

    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(5000);
    expect(result.error).toBeNull();
  });

  it('accumulates sessionId, model, and usage from mock CLI output', async () => {
    adapter.buildCommand = () => mockCommand();
    const proc = spawn(makeOptions());

    const events = await collectEvents(proc.events);
    const result = await proc.done;

    expect(result.sessionId).toBe('mock-session-001');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      cost: 0.001,
    });

    // Text event should contain stdin content
    const textEvent = events.find((e) => e.type === 'text');
    expect(textEvent?.content).toBe('hello world');
  });

  it('non-zero exit produces error in CliResult', async () => {
    adapter.buildCommand = () => mockCommand('--exit-code', '1');
    const proc = spawn(makeOptions());

    const result = await proc.done;

    expect(result.exitCode).toBe(1);
    expect(result.error).not.toBeNull();
    expect(result.error!.code).toBe('unknown');
  });

  it('interrupt sends SIGTERM and process exits', async () => {
    adapter.buildCommand = () => mockCommand('--delay-ms', '30000');
    const proc = spawn(makeOptions());

    // Wait for process to start
    await new Promise((r) => setTimeout(r, 100));

    const result = await proc.interrupt();

    expect(result).toBeDefined();
    expect(result.exitCode).not.toBe(0);
  });

  it('AbortSignal triggers interrupt', async () => {
    adapter.buildCommand = () => mockCommand('--delay-ms', '30000');

    const ac = new AbortController();
    const proc = spawn(makeOptions({ abortSignal: ac.signal }));

    await new Promise((r) => setTimeout(r, 100));
    ac.abort();

    const result = await proc.done;
    expect(result).toBeDefined();
    expect(result.exitCode).not.toBe(0);
  });

  it('ENOENT binary produces binary_not_found error', async () => {
    adapter.buildCommand = () => ({
      bin: '/nonexistent/binary/spawner-test-xxxx',
      args: [],
      stdinInput: 'test',
    });

    const proc = spawn(makeOptions());
    const result = await proc.done.catch((r) => r);

    expect(result.error.code).toBe('binary_not_found');
    expect(result.error.message).toContain('Binary not found');
  });

  it('concurrent spawns produce independent results', async () => {
    const processes = [0, 1, 2].map((i) => {
      adapter.buildCommand = () => ({
        bin: 'node',
        args: [MOCK_CLI],
        stdinInput: `message-${i}`,
      });
      return spawn(makeOptions());
    });

    const results = await Promise.all(processes.map((p) => p.done));
    const allEvents = await Promise.all(processes.map((p) => collectEvents(p.events)));

    // All three should succeed independently
    for (const result of results) {
      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe('mock-session-001');
    }

    // Each process should have its own events
    for (const events of allEvents) {
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[events.length - 1].type).toBe('done');
    }
  });

  it('SIGTERM-ignoring process receives SIGKILL after graceMs', { timeout: 10000 }, async () => {
    adapter.buildCommand = () => mockCommand('--delay-ms', '60000', '--ignore-sigterm');
    const proc = spawn(makeOptions());

    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    const result = await proc.interrupt(200);
    const elapsed = Date.now() - start;

    expect(result).toBeDefined();
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(5000);
  });
});
