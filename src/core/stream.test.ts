import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { CliEvent } from '../types.js';
import type { CliAdapter, SessionAccumulator } from '../adapters/types.js';
import { createAccumulator } from '../adapters/types.js';
import { createStream } from './stream.js';

function makeMockAdapter(handler?: (line: string, acc: SessionAccumulator) => CliEvent[]): CliAdapter {
  return {
    name: 'claude',
    buildCommand: vi.fn() as unknown as CliAdapter['buildCommand'],
    detect: vi.fn() as unknown as CliAdapter['detect'],
    classifyError: vi.fn() as unknown as CliAdapter['classifyError'],
    parseLine: handler ?? ((line: string) => {
      if (!line.trim()) return [];
      return [{ type: 'text', content: line, timestamp: 0, raw: line }];
    }),
  };
}

async function collectEvents(iterable: AsyncIterable<CliEvent>): Promise<CliEvent[]> {
  const events: CliEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('createStream', () => {
  it('yields events from adapter.parseLine for each stdout line', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter();

    const { events, result } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stdout.write('hello\n');
    stdout.write('world\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    const { accumulator } = await result;

    expect(collected).toHaveLength(2);
    expect(collected[0].type).toBe('text');
    expect(collected[0].content).toBe('hello');
    expect(collected[1].content).toBe('world');
    expect(accumulator).toBeDefined();
  });

  it('assigns timestamp to each event', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter();

    const { events } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stdout.write('line1\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    expect(collected[0].timestamp).toBeTypeOf('number');
    expect(collected[0].timestamp).toBeGreaterThan(0);
  });

  it('passes empty lines to adapter (adapter decides behavior)', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const parseLine = vi.fn().mockReturnValue([]);
    const adapter = makeMockAdapter(parseLine);

    const { events } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stdout.write('\n');
    stdout.write('data\n');
    stdout.end();
    stderr.end();

    await collecting;
    expect(parseLine).toHaveBeenCalledWith('', expect.any(Object));
    expect(parseLine).toHaveBeenCalledWith('data', expect.any(Object));
  });

  it('buffers stderr without emitting events when verbose=false', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter();

    const { events, result } = createStream({ stdout, stderr, adapter, verbose: false });
    const collecting = collectEvents(events);

    stderr.write('error output\n');
    stdout.write('data\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    const { stderr: stderrBuf } = await result;

    // Only the stdout event should appear, not the stderr
    expect(collected).toHaveLength(1);
    expect(collected[0].content).toBe('data');
    expect(stderrBuf).toBe('error output\n');
  });

  it('emits stderr as system events when verbose=true', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter();

    const { events, result } = createStream({ stdout, stderr, adapter, verbose: true });
    const collecting = collectEvents(events);

    stderr.write('warning: something\n');
    stdout.write('data\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    const { stderr: stderrBuf } = await result;

    const systemEvents = collected.filter((e) => e.type === 'system');
    expect(systemEvents.length).toBeGreaterThanOrEqual(1);
    expect(systemEvents.some((e) => e.content === 'warning: something')).toBe(true);
    expect(stderrBuf).toBe('warning: something\n');
  });

  it('exposes final accumulator state after stream ends', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter((line: string, acc: SessionAccumulator) => {
      if (line === 'session-line') {
        acc.sessionId = 'sess-123';
        acc.model = 'opus-4';
        acc.inputTokens += 100;
        acc.outputTokens += 50;
        return [{ type: 'system', content: 'session', timestamp: 0, raw: line }];
      }
      return [{ type: 'text', content: line, timestamp: 0, raw: line }];
    });

    const { events, result } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stdout.write('session-line\n');
    stdout.write('hello\n');
    stdout.end();
    stderr.end();

    await collecting;
    const { accumulator } = await result;

    expect(accumulator.sessionId).toBe('sess-123');
    expect(accumulator.model).toBe('opus-4');
    expect(accumulator.inputTokens).toBe(100);
    expect(accumulator.outputTokens).toBe(50);
  });

  it('handles adapter returning multiple events per line', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter((line: string) => [
      { type: 'text', content: 'a', timestamp: 0, raw: line },
      { type: 'tool_use', tool: { name: 'test' }, timestamp: 0, raw: line },
    ]);

    const { events } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stdout.write('multi\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    expect(collected).toHaveLength(2);
    expect(collected[0].type).toBe('text');
    expect(collected[1].type).toBe('tool_use');
  });

  it('handles adapter returning zero events (metadata-only lines)', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter(() => []);

    const { events } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stdout.write('metadata\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    expect(collected).toHaveLength(0);
  });

  it('returns accumulated stderr alongside accumulator', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const adapter = makeMockAdapter();

    const { events, result } = createStream({ stdout, stderr, adapter });
    const collecting = collectEvents(events);

    stderr.write('err1\n');
    stderr.write('err2\n');
    stdout.end();
    stderr.end();

    await collecting;
    const { stderr: stderrBuf } = await result;

    expect(stderrBuf).toBe('err1\nerr2\n');
  });

  it('works with real Claude adapter parseLine', async () => {
    // Integration-style test with the actual Claude adapter
    const { claudeAdapter } = await import('../adapters/claude.js');
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    const { events, result } = createStream({ stdout, stderr, adapter: claudeAdapter });
    const collecting = collectEvents(events);

    const systemLine = JSON.stringify({ type: 'system', session_id: 'sess-1', model: 'opus-4' });
    const textLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } });
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-1', model: 'opus-4', usage: { input_tokens: 100, output_tokens: 50 }, cost_usd: 0.005 });

    stdout.write(systemLine + '\n');
    stdout.write(textLine + '\n');
    stdout.write(resultLine + '\n');
    stdout.end();
    stderr.end();

    const collected = await collecting;
    const { accumulator } = await result;

    expect(collected).toHaveLength(2); // system + text (result line produces no events)
    expect(collected[0].type).toBe('system');
    expect(collected[1].type).toBe('text');
    expect(collected[1].content).toBe('Hello');
    expect(accumulator.sessionId).toBe('sess-1');
    expect(accumulator.model).toBe('opus-4');
    expect(accumulator.inputTokens).toBe(100);
    expect(accumulator.outputTokens).toBe(50);
    expect(accumulator.cost).toBe(0.005);
  });
});
