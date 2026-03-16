import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';

vi.mock('../core/detect.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../core/detect.js';
import { claudeAdapter } from './claude.js';

const mockExecCommand = vi.mocked(execCommand);

describe('claudeAdapter.detect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns installed, version, and authenticated when all succeed', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.3', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } satisfies ExecResult);

    const result = await claudeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.3',
      authenticated: true,
      binaryPath: 'claude',
    });

    expect(mockExecCommand).toHaveBeenCalledWith('claude', ['--version']);
    expect(mockExecCommand).toHaveBeenCalledWith('claude', ['auth', 'status']);
  });

  it('returns not-installed when ENOENT', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'enoent' } satisfies ExecError);

    const result = await claudeAdapter.detect();
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

    const result = await claudeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'claude',
    });

    expect(mockExecCommand).toHaveBeenCalledTimes(1);
  });

  it('returns authenticated: false when auth command exits non-zero', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.3', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: '', stderr: 'not logged in', exitCode: 1 } satisfies ExecResult);

    const result = await claudeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.3',
      authenticated: false,
      binaryPath: 'claude',
    });
  });

  it('returns authenticated: false when auth command times out', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.3', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ kind: 'timeout' } satisfies ExecError);

    const result = await claudeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.3',
      authenticated: false,
      binaryPath: 'claude',
    });
  });

  it('returns installed: true with version null on unknown error', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'error', error: new Error('something') } satisfies ExecError);

    const result = await claudeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'claude',
    });
  });
});
