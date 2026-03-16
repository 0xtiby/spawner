import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';
import type { SpawnOptions } from '../types.js';

vi.mock('../core/detect.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../core/detect.js';
import { opencodeAdapter } from './opencode.js';

const baseOptions: SpawnOptions = { cli: 'opencode', prompt: 'hello', cwd: '/tmp' };

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

describe('opencodeAdapter.buildCommand', () => {
  it('returns base flags for minimal options', () => {
    const result = opencodeAdapter.buildCommand(baseOptions);
    expect(result).toEqual({
      bin: 'opencode',
      args: ['run', '--format', 'json'],
      stdinInput: 'hello',
    });
  });

  it('maps model flag', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, model: 'anthropic/claude-sonnet' });
    expect(result.args).toContain('--model');
    expect(result.args).toContain('anthropic/claude-sonnet');
  });

  it('maps sessionId to --session', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, sessionId: 'abc-123' });
    expect(result.args).toContain('--session');
    expect(result.args).toContain('abc-123');
  });

  it('maps continueSession to --continue', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, continueSession: true });
    expect(result.args).toContain('--continue');
  });

  it('maps sessionId + forkSession to --session + --fork', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, sessionId: 'abc', forkSession: true });
    expect(result.args).toContain('--session');
    expect(result.args).toContain('abc');
    expect(result.args).toContain('--fork');
  });

  it('maps continueSession + forkSession to --continue + --fork', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, continueSession: true, forkSession: true });
    expect(result.args).toContain('--continue');
    expect(result.args).toContain('--fork');
  });

  it('sessionId takes precedence over continueSession', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, sessionId: 'abc', continueSession: true });
    expect(result.args).toContain('--session');
    expect(result.args).toContain('abc');
    expect(result.args).not.toContain('--continue');
  });

  it('ignores forkSession without sessionId or continueSession', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, forkSession: true });
    expect(result.args).not.toContain('--fork');
  });

  it('silently ignores autoApprove', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, autoApprove: true });
    expect(result.args).toEqual(['run', '--format', 'json']);
  });

  it('silently ignores addDirs', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, addDirs: ['/a', '/b'] });
    expect(result.args).not.toContain('--add-dir');
  });

  it('silently ignores ephemeral', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, ephemeral: true });
    expect(result.args).not.toContain('--ephemeral');
    expect(result.args).not.toContain('--no-session-persistence');
  });

  it('silently ignores effort', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, effort: 'high' });
    expect(result.args).not.toContain('--effort');
    expect(result.args).not.toContain('high');
  });

  it('appends extraArgs at the end', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, extraArgs: ['--max-turns', '10'] });
    const args = result.args;
    expect(args[args.length - 2]).toBe('--max-turns');
    expect(args[args.length - 1]).toBe('10');
  });

  it('delivers prompt via stdinInput', () => {
    const result = opencodeAdapter.buildCommand({ ...baseOptions, prompt: 'do something' });
    expect(result.stdinInput).toBe('do something');
  });
});
