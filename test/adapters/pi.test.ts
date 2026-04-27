import { describe, it, expect, beforeEach } from 'vitest';
import { piAdapter } from '../../src/adapters/pi.js';
import { createAccumulator, type SessionAccumulator } from '../../src/adapters/types.js';

function parseAll(lines: string[], acc: SessionAccumulator) {
  return lines.flatMap((line) => piAdapter.parseLine(line, acc));
}

describe('piAdapter shape', () => {
  it('has name "pi" and all required methods', () => {
    expect(piAdapter.name).toBe('pi');
    expect(typeof piAdapter.buildCommand).toBe('function');
    expect(typeof piAdapter.parseLine).toBe('function');
    expect(typeof piAdapter.detect).toBe('function');
    expect(typeof piAdapter.classifyError).toBe('function');
  });
});

describe('piAdapter.buildCommand', () => {
  const base = { cli: 'pi' as const, prompt: 'hello', cwd: '/tmp' };

  it('builds basic command with --mode json and prompt as last positional', () => {
    const { bin, args } = piAdapter.buildCommand(base);
    expect(bin).toBe('pi');
    expect(args[0]).toBe('--mode');
    expect(args[1]).toBe('json');
    expect(args[args.length - 1]).toBe('hello');
  });

  it('adds --model when model option is provided', () => {
    const { args } = piAdapter.buildCommand({ ...base, model: 'gpt-5' });
    const i = args.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('gpt-5');
    expect(args.indexOf('--model')).toBeLessThan(args.length - 1);
  });

  it('adds --session for sessionId', () => {
    const { args } = piAdapter.buildCommand({ ...base, sessionId: 'sess-1' });
    const i = args.indexOf('--session');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('sess-1');
  });

  it('adds --continue for continueSession', () => {
    const { args } = piAdapter.buildCommand({ ...base, continueSession: true });
    expect(args).toContain('--continue');
  });

  it('forkSession with sessionId strips --session/--continue and adds --fork', () => {
    const { args } = piAdapter.buildCommand({
      ...base,
      sessionId: 'sess-1',
      continueSession: true,
      forkSession: true,
    });
    expect(args).not.toContain('--session');
    expect(args).not.toContain('--continue');
    const i = args.indexOf('--fork');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('sess-1');
  });

  it('forkSession without sessionId is a no-op (no --fork)', () => {
    const { args } = piAdapter.buildCommand({ ...base, forkSession: true });
    expect(args).not.toContain('--fork');
  });

  it('adds --no-session for ephemeral', () => {
    const { args } = piAdapter.buildCommand({ ...base, ephemeral: true });
    expect(args).toContain('--no-session');
  });

  it('adds --verbose when verbose is true', () => {
    const { args } = piAdapter.buildCommand({ ...base, verbose: true });
    expect(args).toContain('--verbose');
  });

  it('maps effort to --thinking flag', () => {
    const { args } = piAdapter.buildCommand({ ...base, effort: 'high' });
    const i = args.indexOf('--thinking');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('high');
  });

  it('maps effort=max and effort=xhigh to --thinking xhigh', () => {
    const max = piAdapter.buildCommand({ ...base, effort: 'max' });
    const xhigh = piAdapter.buildCommand({ ...base, effort: 'xhigh' });
    expect(max.args[max.args.indexOf('--thinking') + 1]).toBe('xhigh');
    expect(xhigh.args[xhigh.args.indexOf('--thinking') + 1]).toBe('xhigh');
  });

  it('maps effort=off and effort=minimal to --thinking off/minimal', () => {
    const off = piAdapter.buildCommand({ ...base, effort: 'off' });
    const minimal = piAdapter.buildCommand({ ...base, effort: 'minimal' });
    expect(off.args[off.args.indexOf('--thinking') + 1]).toBe('off');
    expect(minimal.args[minimal.args.indexOf('--thinking') + 1]).toBe('minimal');
  });

  it('inserts extraArgs before the positional prompt', () => {
    const { args } = piAdapter.buildCommand({ ...base, extraArgs: ['--foo', 'bar'] });
    const promptIdx = args.lastIndexOf('hello');
    expect(args.indexOf('--foo')).toBeLessThan(promptIdx);
    expect(args.indexOf('bar')).toBeLessThan(promptIdx);
  });

  it('passes prompt as positional (no stdin)', () => {
    const cmd = piAdapter.buildCommand({ ...base });
    expect(cmd.stdinInput).toBeUndefined();
    expect(cmd.args[cmd.args.length - 1]).toBe('hello');
  });
});

describe('piAdapter.parseLine', () => {
  let acc: SessionAccumulator;

  beforeEach(() => {
    acc = createAccumulator();
  });

  it('returns [] for empty/whitespace lines', () => {
    expect(piAdapter.parseLine('', acc)).toEqual([]);
    expect(piAdapter.parseLine('   ', acc)).toEqual([]);
  });

  it('non-JSON line falls back to system event', () => {
    const events = piAdapter.parseLine('not json', acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
    expect(events[0].content).toBe('not json');
  });

  it('unrecognized event type falls back to system event', () => {
    const line = JSON.stringify({ type: 'unknown_future_type', foo: 1 });
    const events = piAdapter.parseLine(line, acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
  });

  it('session event captures sessionId and model into accumulator', () => {
    const line = JSON.stringify({ type: 'session', id: 'sess-xyz', model: 'gpt-5' });
    const events = piAdapter.parseLine(line, acc);
    expect(acc.sessionId).toBe('sess-xyz');
    expect(acc.model).toBe('gpt-5');
    expect(events[0].type).toBe('system');
  });

  it('message_update with text_end emits text event', () => {
    const line = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', content: 'Hello world' },
    });
    const events = piAdapter.parseLine(line, acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text');
    expect(events[0].content).toBe('Hello world');
  });

  it('message_update with toolcall_end emits tool_use event', () => {
    const line = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        toolCall: { name: 'bash', arguments: { cmd: 'ls' } },
      },
    });
    const events = piAdapter.parseLine(line, acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_use');
    expect(events[0].tool).toEqual({ name: 'bash', input: { cmd: 'ls' } });
  });

  it('tool_execution_end emits tool_result event', () => {
    const line = JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'output here' }] },
      isError: false,
    });
    const events = piAdapter.parseLine(line, acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_result');
    expect(events[0].toolResult?.name).toBe('bash');
    expect(events[0].toolResult?.output).toBe('output here');
    expect(events[0].toolResult?.error).toBeUndefined();
  });

  it('tool_execution_end with isError sets toolResult.error', () => {
    const line = JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'boom' }] },
      isError: true,
    });
    const events = piAdapter.parseLine(line, acc);
    expect(events[0].toolResult?.error).toBe('boom');
  });

  it('message_end accumulates token usage and cost', () => {
    const line = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        usage: { input: 100, output: 50, cost: { total: 0.0042 } },
      },
    });
    piAdapter.parseLine(line, acc);
    expect(acc.inputTokens).toBe(100);
    expect(acc.outputTokens).toBe(50);
    expect(acc.cost).toBe(0.0042);
  });

  it('message_end with stopReason=error emits error event', () => {
    const line = JSON.stringify({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
    });
    const events = piAdapter.parseLine(line, acc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].content).toBe('boom');
  });

  it('turn_end accumulates usage and emits system event', () => {
    const line = JSON.stringify({
      type: 'turn_end',
      message: {
        usage: { input: 200, output: 80, cost: { total: 0.01 } },
      },
    });
    const events = piAdapter.parseLine(line, acc);
    expect(acc.inputTokens).toBe(200);
    expect(acc.outputTokens).toBe(80);
    expect(acc.cost).toBe(0.01);
    expect(events[0].type).toBe('system');
  });

  it('message_update with assistantMessageEvent.type=error emits error event', () => {
    const line = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'error', error: { errorMessage: 'rate limited' } },
    });
    const events = piAdapter.parseLine(line, acc);
    expect(events[0].type).toBe('error');
    expect(events[0].content).toBe('rate limited');
  });

  it('thinking_start/thinking_delta/thinking_end inside message_update are skipped', () => {
    const start = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_start' },
    });
    const delta = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
    });
    const end = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_end', content: 'done thinking' },
    });
    expect(piAdapter.parseLine(start, acc)).toEqual([]);
    expect(piAdapter.parseLine(delta, acc)).toEqual([]);
    expect(piAdapter.parseLine(end, acc)).toEqual([]);
  });

  it('all events have raw and timestamp fields', () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 's', model: 'm' }),
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', content: 'hi' },
      }),
    ];
    const events = parseAll(lines, acc);
    for (const ev of events) {
      expect(typeof ev.raw).toBe('string');
      expect(ev.raw.length).toBeGreaterThan(0);
      expect(typeof ev.timestamp).toBe('number');
    }
  });
});

describe('piAdapter.classifyError', () => {
  it('classifies model_not_found from stderr', () => {
    const err = piAdapter.classifyError(1, 'Error: model not found: foo', '');
    expect(err.code).toBe('model_not_found');
    expect(err.retryable).toBe(false);
  });

  it('classifies auth errors', () => {
    const err = piAdapter.classifyError(1, 'unauthorized: bad api key', '');
    expect(err.code).toBe('auth');
  });

  it('classifies rate limit errors', () => {
    const err = piAdapter.classifyError(1, 'rate limit exceeded', '');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
  });

  it('classifies context_overflow errors', () => {
    const err = piAdapter.classifyError(1, 'context length exceeded', '');
    expect(err.code).toBe('context_overflow');
  });

  it('falls through to default classification for unrecognized errors', () => {
    const err = piAdapter.classifyError(1, 'something else broke', '');
    expect(['fatal', 'unknown']).toContain(err.code);
  });
});
