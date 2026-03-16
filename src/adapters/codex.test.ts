import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';
import type { SpawnOptions } from '../types.js';

vi.mock('../core/detect.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../core/detect.js';
import { codexAdapter } from './codex.js';

const baseOptions: SpawnOptions = { cli: 'codex', prompt: 'hello', cwd: '/tmp' };

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

describe('codexAdapter.buildCommand', () => {
  it('returns exec --json for new session', () => {
    const result = codexAdapter.buildCommand(baseOptions);
    expect(result).toEqual({
      bin: 'codex',
      args: ['exec', '--json'],
      stdinInput: 'hello',
    });
  });

  it('returns exec resume <id> for resume by sessionId', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, sessionId: 'sess-123' });
    expect(result.args[0]).toBe('exec');
    expect(result.args[1]).toBe('resume');
    expect(result.args[2]).toBe('sess-123');
    expect(result.args).not.toContain('--json');
  });

  it('returns exec resume --last for continueSession', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, continueSession: true });
    expect(result.args[0]).toBe('exec');
    expect(result.args[1]).toBe('resume');
    expect(result.args[2]).toBe('--last');
    expect(result.args).not.toContain('--json');
  });

  it('returns fork <id> for forkSession + sessionId', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, forkSession: true, sessionId: 'sess-123' });
    expect(result.args[0]).toBe('fork');
    expect(result.args[1]).toBe('sess-123');
    expect(result.stdinInput).toBeUndefined();
  });

  it('fork mode ignores prompt (stdinInput undefined)', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, prompt: 'ignored', forkSession: true, sessionId: 'sess-123' });
    expect(result.stdinInput).toBeUndefined();
  });

  it('forkSession + continueSession (no sessionId) resolves to resume-last', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, forkSession: true, continueSession: true });
    expect(result.args[0]).toBe('exec');
    expect(result.args[1]).toBe('resume');
    expect(result.args[2]).toBe('--last');
    expect(result.args).not.toContain('fork');
  });

  it('forkSession alone (no sessionId, no continueSession) falls through to new session', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, forkSession: true });
    expect(result.args[0]).toBe('exec');
    expect(result.args[1]).toBe('--json');
  });

  it('sessionId takes precedence over continueSession', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, sessionId: 'sess-123', continueSession: true });
    expect(result.args).toContain('resume');
    expect(result.args).toContain('sess-123');
    expect(result.args).not.toContain('--last');
  });

  it('maps model flag', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, model: 'o3' });
    expect(result.args).toContain('--model');
    expect(result.args).toContain('o3');
  });

  it('maps autoApprove to --full-auto', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, autoApprove: true });
    expect(result.args).toContain('--full-auto');
  });

  it('maps addDirs to multiple --add-dir flags', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, addDirs: ['/a', '/b'] });
    const addDirIndices = result.args.reduce<number[]>((acc, arg, i) => {
      if (arg === '--add-dir') acc.push(i);
      return acc;
    }, []);
    expect(addDirIndices).toHaveLength(2);
    expect(result.args[addDirIndices[0] + 1]).toBe('/a');
    expect(result.args[addDirIndices[1] + 1]).toBe('/b');
  });

  it('maps ephemeral to --ephemeral', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, ephemeral: true });
    expect(result.args).toContain('--ephemeral');
  });

  it('maps effort to -c model_reasoning_effort=<value>', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, effort: 'high' });
    expect(result.args).toContain('-c');
    expect(result.args).toContain('model_reasoning_effort=high');
  });

  it('appends extraArgs at the end', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, extraArgs: ['--yolo'] });
    expect(result.args[result.args.length - 1]).toBe('--yolo');
  });

  it('delivers prompt via stdinInput for exec mode', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, prompt: 'do something' });
    expect(result.stdinInput).toBe('do something');
  });

  it('delivers prompt via stdinInput for resume mode', () => {
    const result = codexAdapter.buildCommand({ ...baseOptions, sessionId: 'sess-123', prompt: 'follow up' });
    expect(result.stdinInput).toBe('follow up');
  });
});
