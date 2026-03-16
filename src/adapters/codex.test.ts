import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';

vi.mock('../core/detect.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../core/detect.js';
import { codexAdapter } from './codex.js';

const mockExecCommand = vi.mocked(execCommand);

describe('codexAdapter.detect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns installed, version, and authenticated when all succeed', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '0.5.1', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } satisfies ExecResult);

    const result = await codexAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '0.5.1',
      authenticated: true,
      binaryPath: 'codex',
    });

    expect(mockExecCommand).toHaveBeenCalledWith('codex', ['--version']);
    expect(mockExecCommand).toHaveBeenCalledWith('codex', ['login', 'status']);
  });

  it('returns not-installed when ENOENT', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'enoent' } satisfies ExecError);

    const result = await codexAdapter.detect();
    expect(result).toEqual({
      installed: false,
      version: null,
      authenticated: false,
      binaryPath: null,
    });

    expect(mockExecCommand).toHaveBeenCalledTimes(1);
  });

  it('returns installed but no version on timeout', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'timeout' } satisfies ExecError);

    const result = await codexAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'codex',
    });

    expect(mockExecCommand).toHaveBeenCalledTimes(1);
  });

  it('returns authenticated: false when login status exits non-zero', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '0.5.1', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: '', stderr: 'not logged in', exitCode: 1 } satisfies ExecResult);

    const result = await codexAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '0.5.1',
      authenticated: false,
      binaryPath: 'codex',
    });
  });

  it('returns authenticated: false when auth command times out', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '0.5.1', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ kind: 'timeout' } satisfies ExecError);

    const result = await codexAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '0.5.1',
      authenticated: false,
      binaryPath: 'codex',
    });
  });

  it('returns installed: true with version null on unknown error', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'error', error: new Error('something') } satisfies ExecError);

    const result = await codexAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'codex',
    });
  });
});
