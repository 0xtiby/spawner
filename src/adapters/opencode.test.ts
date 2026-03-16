import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';

vi.mock('../core/detect.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../core/detect.js';
import { opencodeAdapter } from './opencode.js';

const mockExecCommand = vi.mocked(execCommand);

describe('opencodeAdapter.detect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns installed, version, and authenticated when providers listed', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.0', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: 'anthropic: configured\nopenai: configured', stderr: '', exitCode: 0 } satisfies ExecResult);

    const result = await opencodeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.0',
      authenticated: true,
      binaryPath: 'opencode',
    });

    expect(mockExecCommand).toHaveBeenCalledWith('opencode', ['--version']);
    expect(mockExecCommand).toHaveBeenCalledWith('opencode', ['auth', 'list']);
  });

  it('returns authenticated: false when auth list is empty', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.0', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } satisfies ExecResult);

    const result = await opencodeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.0',
      authenticated: false,
      binaryPath: 'opencode',
    });
  });

  it('returns not-installed when ENOENT', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'enoent' } satisfies ExecError);

    const result = await opencodeAdapter.detect();
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

    const result = await opencodeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'opencode',
    });

    expect(mockExecCommand).toHaveBeenCalledTimes(1);
  });

  it('returns authenticated: false when auth command errors', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.0', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ kind: 'error', error: new Error('auth failed') } satisfies ExecError);

    const result = await opencodeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.0',
      authenticated: false,
      binaryPath: 'opencode',
    });
  });

  it('returns authenticated: false when auth list is whitespace only', async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: '1.2.0', stderr: '', exitCode: 0 } satisfies ExecResult)
      .mockResolvedValueOnce({ stdout: '   \n  ', stderr: '', exitCode: 0 } satisfies ExecResult);

    const result = await opencodeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: '1.2.0',
      authenticated: false,
      binaryPath: 'opencode',
    });
  });

  it('returns installed: true with version null on unknown error', async () => {
    mockExecCommand.mockResolvedValueOnce({ kind: 'error', error: new Error('something') } satisfies ExecError);

    const result = await opencodeAdapter.detect();
    expect(result).toEqual({
      installed: true,
      version: null,
      authenticated: false,
      binaryPath: 'opencode',
    });
  });
});
