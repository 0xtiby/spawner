import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execCommand, detect, detectAll } from './detect.js';

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn(),
}));

import { getAdapter } from '../adapters/index.js';
const mockGetAdapter = vi.mocked(getAdapter);

describe('execCommand', () => {
  it('returns stdout on success', async () => {
    const result = await execCommand('echo', ['hello']);
    expect(result).toMatchObject({ stdout: 'hello', exitCode: 0 });
  });

  it('returns non-zero exit code on failure', async () => {
    const result = await execCommand('node', ['-e', 'process.exit(42)']);
    expect(result).toMatchObject({ exitCode: 42 });
  });

  it('returns ENOENT when binary not found', async () => {
    const result = await execCommand('__nonexistent_binary_xyz__', ['--version']);
    expect(result).toEqual({ kind: 'enoent' });
  });

  it('kills process and returns timeout after deadline', async () => {
    const result = await execCommand('sleep', ['30'], 200);
    expect(result).toEqual({ kind: 'timeout' });
  }, 5_000);
});

describe('detect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to the correct adapter', async () => {
    const mockDetect = vi.fn().mockResolvedValue({
      installed: true,
      version: '1.0.0',
      authenticated: true,
      binaryPath: 'claude',
    });
    mockGetAdapter.mockReturnValue({ detect: mockDetect } as any);

    const result = await detect('claude');
    expect(mockGetAdapter).toHaveBeenCalledWith('claude');
    expect(result).toEqual({
      installed: true,
      version: '1.0.0',
      authenticated: true,
      binaryPath: 'claude',
    });
  });

  it('never throws — returns safe default on adapter error', async () => {
    mockGetAdapter.mockReturnValue({
      detect: () => { throw new Error('boom'); },
    } as any);

    const result = await detect('claude');
    expect(result).toEqual({
      installed: false,
      version: null,
      authenticated: false,
      binaryPath: null,
    });
  });
});

describe('detectAll', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs all three CLIs concurrently and returns keyed results', async () => {
    const makeResult = (cli: string) => ({
      installed: false,
      version: null,
      authenticated: false,
      binaryPath: null,
    });
    mockGetAdapter.mockImplementation((cli) => ({
      detect: () => Promise.resolve(makeResult(cli)),
    } as any));

    const results = await detectAll();
    expect(results).toHaveProperty('claude');
    expect(results).toHaveProperty('codex');
    expect(results).toHaveProperty('opencode');
    expect(mockGetAdapter).toHaveBeenCalledTimes(3);
  });
});
