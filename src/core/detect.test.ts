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

  it('never throws — returns safe default on rejected promise', async () => {
    mockGetAdapter.mockReturnValue({
      detect: () => Promise.reject(new Error('network fail')),
    } as any);

    const result = await detect('codex');
    expect(result).toEqual({
      installed: false,
      version: null,
      authenticated: false,
      binaryPath: null,
    });
  });

  it('returns authenticated false when adapter reports not installed (auth skipped)', async () => {
    const mockDetect = vi.fn().mockResolvedValue({
      installed: false,
      version: null,
      authenticated: false,
      binaryPath: null,
    });
    mockGetAdapter.mockReturnValue({ detect: mockDetect } as any);

    const result = await detect('opencode');
    expect(result.authenticated).toBe(false);
    expect(result.installed).toBe(false);
  });

  it('preserves adapter result when installed but not authed', async () => {
    mockGetAdapter.mockReturnValue({
      detect: () => Promise.resolve({
        installed: true,
        version: '2.0.0',
        authenticated: false,
        binaryPath: 'codex',
      }),
    } as any);

    const result = await detect('codex');
    expect(result).toEqual({
      installed: true,
      version: '2.0.0',
      authenticated: false,
      binaryPath: 'codex',
    });
  });

  it('preserves adapter result when version is null (timeout)', async () => {
    mockGetAdapter.mockReturnValue({
      detect: () => Promise.resolve({
        installed: true,
        version: null,
        authenticated: false,
        binaryPath: 'claude',
      }),
    } as any);

    const result = await detect('claude');
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'claude',
    });
  });
});

describe('detectAll', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs all three CLIs concurrently and returns keyed results', async () => {
    const makeResult = (cli: string) => ({
      installed: true,
      version: `${cli}-1.0`,
      authenticated: cli !== 'opencode',
      binaryPath: cli,
    });
    mockGetAdapter.mockImplementation((cli) => ({
      detect: () => Promise.resolve(makeResult(cli)),
    } as any));

    const results = await detectAll();
    expect(results.claude).toEqual(makeResult('claude'));
    expect(results.codex).toEqual(makeResult('codex'));
    expect(results.opencode).toEqual(makeResult('opencode'));
    expect(mockGetAdapter).toHaveBeenCalledTimes(3);
  });

  it('returns safe defaults for any adapter that throws', async () => {
    mockGetAdapter.mockImplementation((cli) => {
      if (cli === 'codex') {
        return { detect: () => { throw new Error('crash'); } } as any;
      }
      return {
        detect: () => Promise.resolve({
          installed: true, version: '1.0', authenticated: true, binaryPath: cli,
        }),
      } as any;
    });

    const results = await detectAll();
    expect(results.claude.installed).toBe(true);
    expect(results.codex).toEqual({
      installed: false, version: null, authenticated: false, binaryPath: null,
    });
    expect(results.opencode.installed).toBe(true);
  });
});
