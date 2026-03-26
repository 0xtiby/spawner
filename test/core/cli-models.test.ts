import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMockProcess, type MockChildProcess } from '../helpers/mock-process.js';

const mockQueue: MockChildProcess[] = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = mockQueue.shift();
    if (!proc) throw new Error('mockQueue is empty — test is missing a mock process');
    return proc;
  }),
}));

// Import after mock registration
const {
  parseCliModelsOutput,
  fetchCliModels,
  ensureCliModelsCache,
  refreshCliModelsCache,
  clearCliModelsCache,
  getCliModelsCache,
  CliModelsFetchError,
  CLI_MODELS_CACHE_TTL_MS,
} = await import('../../src/core/cli-models.js');

function createEnoentProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = 88888;
  proc.killed = false;
  proc.kill = () => { proc.killed = true; return true; };

  setImmediate(() => {
    const err = new Error('spawn opencode ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    proc.stdout.end();
    proc.stderr.end();
    proc.emit('error', err);
  });

  return proc;
}

function createErrorProcess(error: Error): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = 88889;
  proc.killed = false;
  proc.kill = () => { proc.killed = true; return true; };

  setImmediate(() => {
    proc.stdout.end();
    proc.stderr.end();
    proc.emit('error', error);
  });

  return proc;
}

function createHangingProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = 77777;
  proc.killed = false;
  proc.kill = (signal?: string) => {
    if (proc.killed) return false;
    proc.killed = true;
    proc.emit('close', signal === 'SIGKILL' ? 137 : 143, signal ?? 'SIGTERM');
    return true;
  };

  return proc;
}

describe('parseCliModelsOutput', () => {
  it('parses valid multi-line stdout into KnownModel[]', () => {
    const stdout = [
      'anthropic/claude-sonnet-4-20250514',
      'openai/gpt-4o',
      'google/gemini-2.0-flash',
    ].join('\n');

    const models = parseCliModelsOutput(stdout);
    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet-4-20250514', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', contextWindow: null, supportsEffort: false },
      { id: 'openai/gpt-4o', name: 'openai/gpt-4o', provider: 'openai', contextWindow: null, supportsEffort: false },
      { id: 'google/gemini-2.0-flash', name: 'google/gemini-2.0-flash', provider: 'google', contextWindow: null, supportsEffort: false },
    ]);
  });

  it('returns empty array for empty stdout', () => {
    expect(parseCliModelsOutput('')).toEqual([]);
  });

  it('filters blank lines and trailing newlines', () => {
    const stdout = 'anthropic/claude-sonnet-4-20250514\n\n\nopenai/gpt-4o\n\n';
    const models = parseCliModelsOutput(stdout);
    expect(models).toHaveLength(2);
  });

  it('uses "unknown" as provider when no / separator', () => {
    const models = parseCliModelsOutput('some-model-without-slash');
    expect(models[0]).toEqual({
      id: 'some-model-without-slash',
      name: 'some-model-without-slash',
      provider: 'unknown',
      contextWindow: null,
      supportsEffort: false,
    });
  });
});

describe('fetchCliModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue.length = 0;
    clearCliModelsCache();
  });

  it('returns parsed models on success', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
      exitCode: 0,
    }));

    const models = await fetchCliModels();
    expect(models).toHaveLength(2);
    expect(models[0].provider).toBe('anthropic');
    expect(models[1].provider).toBe('openai');
  });

  it('throws CliModelsFetchError with kind enoent when binary not found', async () => {
    mockQueue.push(createEnoentProcess());

    const err = await fetchCliModels().catch((e: InstanceType<typeof CliModelsFetchError>) => e);
    expect(err).toBeInstanceOf(CliModelsFetchError);
    expect(err.kind).toBe('enoent');
  });

  it('throws CliModelsFetchError with kind timeout', async () => {
    mockQueue.push(createHangingProcess());

    const err = await fetchCliModels().catch((e: InstanceType<typeof CliModelsFetchError>) => e);
    expect(err).toBeInstanceOf(CliModelsFetchError);
    expect(err.kind).toBe('timeout');
  }, 15_000);

  it('throws CliModelsFetchError with kind error and cause on generic spawn error', async () => {
    const cause = new Error('something went wrong');
    mockQueue.push(createErrorProcess(cause));

    const err = await fetchCliModels().catch((e: InstanceType<typeof CliModelsFetchError>) => e);
    expect(err).toBeInstanceOf(CliModelsFetchError);
    expect(err.kind).toBe('error');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('throws CliModelsFetchError with kind exit_code and stderr in message', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: [],
      stderrLines: ['Error: no providers configured'],
      exitCode: 1,
    }));

    const err = await fetchCliModels().catch((e: InstanceType<typeof CliModelsFetchError>) => e);
    expect(err).toBeInstanceOf(CliModelsFetchError);
    expect(err.kind).toBe('exit_code');
    expect(err.message).toContain('no providers configured');
  });
});

describe('cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue.length = 0;
    clearCliModelsCache();
  });

  it('getCliModelsCache returns null initially', () => {
    expect(getCliModelsCache()).toBeNull();
  });

  it('ensureCliModelsCache fetches and caches on first call', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));

    const result = await ensureCliModelsCache();
    expect(result.data).toHaveLength(1);
    expect(result.fetchedAt).toBeGreaterThan(0);
    expect(getCliModelsCache()).toBe(result);
  });

  it('returns cached data without spawning on second call within TTL', async () => {
    const { spawn } = await import('node:child_process');

    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));

    await ensureCliModelsCache();
    const callCount = vi.mocked(spawn).mock.calls.length;

    const result2 = await ensureCliModelsCache();
    expect(result2.data).toHaveLength(1);
    expect(vi.mocked(spawn).mock.calls.length).toBe(callCount); // no new spawn
  });

  it('re-fetches when cache TTL expires', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));

    await ensureCliModelsCache();

    // Simulate TTL expiry by backdating fetchedAt
    const cached = getCliModelsCache()!;
    cached.fetchedAt = Date.now() - CLI_MODELS_CACHE_TTL_MS - 1;

    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
      exitCode: 0,
    }));

    const result = await ensureCliModelsCache();
    expect(result.data).toHaveLength(2);
  });

  it('deduplicates concurrent calls — only one subprocess', async () => {
    const { spawn } = await import('node:child_process');

    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));

    const p1 = ensureCliModelsCache();
    const p2 = ensureCliModelsCache();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(vi.mocked(spawn).mock.calls.length).toBe(1);
  });

  it('refreshCliModelsCache always fetches even with fresh cache', async () => {
    const { spawn } = await import('node:child_process');

    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));
    await ensureCliModelsCache();

    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
      exitCode: 0,
    }));
    const result = await refreshCliModelsCache();
    expect(result.data).toHaveLength(2);
    expect(vi.mocked(spawn).mock.calls.length).toBe(2);
  });

  it('refreshCliModelsCache throws on failure without updating cache', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));
    await ensureCliModelsCache();
    const cached = getCliModelsCache();

    mockQueue.push(createEnoentProcess());
    await expect(refreshCliModelsCache()).rejects.toThrow(CliModelsFetchError);

    // Cache unchanged
    expect(getCliModelsCache()).toBe(cached);
  });

  it('returns stale cache when fetch fails after TTL expiry', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));

    await ensureCliModelsCache();
    const cached = getCliModelsCache()!;
    cached.fetchedAt = Date.now() - CLI_MODELS_CACHE_TTL_MS - 1;

    mockQueue.push(createEnoentProcess());

    const result = await ensureCliModelsCache();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('throws when fetch fails with no prior cache', async () => {
    mockQueue.push(createEnoentProcess());
    await expect(ensureCliModelsCache()).rejects.toThrow(CliModelsFetchError);
  });

  it('clearCliModelsCache invalidates cache', async () => {
    mockQueue.push(createMockProcess({
      stdoutLines: ['anthropic/claude-sonnet-4-20250514'],
      exitCode: 0,
    }));
    await ensureCliModelsCache();
    expect(getCliModelsCache()).not.toBeNull();

    clearCliModelsCache();
    expect(getCliModelsCache()).toBeNull();
  });
});
