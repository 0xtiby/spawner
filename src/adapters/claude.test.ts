import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';
import type { SpawnOptions } from '../types.js';

vi.mock('../core/detect.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../core/detect.js';
import { claudeAdapter } from './claude.js';

const baseOptions: SpawnOptions = { cli: 'claude', prompt: 'hello', cwd: '/tmp' };

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

describe('claudeAdapter.buildCommand', () => {
  it('returns base flags for minimal options', () => {
    const result = claudeAdapter.buildCommand(baseOptions);
    expect(result).toEqual({
      bin: 'claude',
      args: ['--print', '--output-format', 'stream-json', '--verbose'],
      stdinInput: 'hello',
    });
  });

  it('maps model flag', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, model: 'opus-4' });
    expect(result.args).toContain('--model');
    expect(result.args).toContain('opus-4');
  });

  it('maps sessionId to --resume', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, sessionId: 'abc-123' });
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('abc-123');
  });

  it('maps continueSession to --continue', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, continueSession: true });
    expect(result.args).toContain('--continue');
  });

  it('maps sessionId + forkSession to --resume + --fork-session', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, sessionId: 'abc', forkSession: true });
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('abc');
    expect(result.args).toContain('--fork-session');
  });

  it('maps continueSession + forkSession to --continue + --fork-session', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, continueSession: true, forkSession: true });
    expect(result.args).toContain('--continue');
    expect(result.args).toContain('--fork-session');
  });

  it('sessionId takes precedence over continueSession', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, sessionId: 'abc', continueSession: true });
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('abc');
    expect(result.args).not.toContain('--continue');
  });

  it('ignores forkSession without sessionId or continueSession', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, forkSession: true });
    expect(result.args).not.toContain('--fork-session');
  });

  it('maps effort flag', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, effort: 'high' });
    expect(result.args).toContain('--effort');
    expect(result.args).toContain('high');
  });

  it('maps autoApprove to --dangerously-skip-permissions', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, autoApprove: true });
    expect(result.args).toContain('--dangerously-skip-permissions');
  });

  it('maps addDirs to multiple --add-dir flags', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, addDirs: ['/a', '/b'] });
    const addDirIndices = result.args.reduce<number[]>((acc, arg, i) => {
      if (arg === '--add-dir') acc.push(i);
      return acc;
    }, []);
    expect(addDirIndices).toHaveLength(2);
    expect(result.args[addDirIndices[0] + 1]).toBe('/a');
    expect(result.args[addDirIndices[1] + 1]).toBe('/b');
  });

  it('maps ephemeral to --no-session-persistence', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, ephemeral: true });
    expect(result.args).toContain('--no-session-persistence');
  });

  it('appends extraArgs at the end', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, extraArgs: ['--max-turns', '10'] });
    const args = result.args;
    expect(args[args.length - 2]).toBe('--max-turns');
    expect(args[args.length - 1]).toBe('10');
  });

  it('delivers prompt via stdinInput', () => {
    const result = claudeAdapter.buildCommand({ ...baseOptions, prompt: 'do something' });
    expect(result.stdinInput).toBe('do something');
  });
});
