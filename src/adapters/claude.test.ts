import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecResult, ExecError } from '../core/detect.js';
import type { SpawnOptions } from '../types.js';
import type { SessionAccumulator } from './types.js';
import { createAccumulator } from './types.js';

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

describe('claudeAdapter.parseLine', () => {
  let acc: SessionAccumulator;

  beforeEach(() => {
    acc = createAccumulator();
  });

  it('returns empty array for empty string', () => {
    expect(claudeAdapter.parseLine('', acc)).toEqual([]);
  });

  it('returns empty array for whitespace-only line', () => {
    expect(claudeAdapter.parseLine('   ', acc)).toEqual([]);
  });

  it('returns system event for invalid JSON', () => {
    const events = claudeAdapter.parseLine('not json at all', acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
    expect(events[0].content).toBe('not json at all');
    expect(events[0].raw).toBe('not json at all');
    expect(events[0].timestamp).toBeTypeOf('number');
  });

  it('parses system line — updates accumulator and returns system event', () => {
    const line = JSON.stringify({ type: 'system', session_id: 'sess-1', model: 'opus-4' });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
    expect(events[0].content).toContain('session=sess-1');
    expect(events[0].content).toContain('model=opus-4');
    expect(events[0].raw).toBe(line);
    expect(acc.sessionId).toBe('sess-1');
    expect(acc.model).toBe('opus-4');
  });

  it('parses assistant line with text block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text');
    expect(events[0].content).toBe('Hello world');
    expect(events[0].raw).toBe(line);
  });

  it('parses assistant line with tool_use block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'read_file', input: { path: '/foo' } }] },
    });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_use');
    expect(events[0].tool).toEqual({ name: 'read_file', input: { path: '/foo' } });
    expect(events[0].raw).toBe(line);
  });

  it('parses assistant line with tool_result block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_result', name: 'read_file', content: 'file contents', is_error: false }] },
    });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_result');
    expect(events[0].toolResult).toEqual({ name: 'read_file', output: 'file contents', error: undefined });
  });

  it('parses assistant line with tool_result error block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_result', name: 'run', content: 'failed', is_error: true }] },
    });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toHaveLength(1);
    expect(events[0].toolResult).toEqual({ name: 'run', output: 'failed', error: 'failed' });
  });

  it('parses assistant line with mixed text and tool_use blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', name: 'read_file', input: { path: '/bar' } },
        ],
      },
    });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('text');
    expect(events[0].content).toBe('Let me read that.');
    expect(events[1].type).toBe('tool_use');
    expect(events[1].tool!.name).toBe('read_file');
  });

  it('parses result line — updates accumulator, returns empty array', () => {
    const line = JSON.stringify({
      type: 'result',
      session_id: 'sess-2',
      model: 'sonnet-4',
      usage: { input_tokens: 100, output_tokens: 50 },
      cost_usd: 0.0042,
    });
    const events = claudeAdapter.parseLine(line, acc);

    expect(events).toEqual([]);
    expect(acc.sessionId).toBe('sess-2');
    expect(acc.model).toBe('sonnet-4');
    expect(acc.inputTokens).toBe(100);
    expect(acc.outputTokens).toBe(50);
    expect(acc.cost).toBe(0.0042);
  });

  it('accumulates tokens across multiple result lines', () => {
    const line1 = JSON.stringify({ type: 'result', usage: { input_tokens: 100, output_tokens: 50 } });
    const line2 = JSON.stringify({ type: 'result', usage: { input_tokens: 200, output_tokens: 75 } });

    claudeAdapter.parseLine(line1, acc);
    claudeAdapter.parseLine(line2, acc);

    expect(acc.inputTokens).toBe(300);
    expect(acc.outputTokens).toBe(125);
  });

  it('every event has raw set to original line', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    const events = claudeAdapter.parseLine(line, acc);
    for (const event of events) {
      expect(event.raw).toBe(line);
    }
  });

  it('every event has a numeric timestamp', () => {
    const line = JSON.stringify({ type: 'system', session_id: 'x' });
    const events = claudeAdapter.parseLine(line, acc);
    for (const event of events) {
      expect(event.timestamp).toBeTypeOf('number');
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  it('handles unknown type as system event', () => {
    const line = JSON.stringify({ type: 'unknown_type', data: 123 });
    const events = claudeAdapter.parseLine(line, acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
    expect(events[0].raw).toBe(line);
  });

  it('handles assistant with no message content gracefully', () => {
    const line = JSON.stringify({ type: 'assistant', message: {} });
    const events = claudeAdapter.parseLine(line, acc);
    expect(events).toEqual([]);
  });
});
