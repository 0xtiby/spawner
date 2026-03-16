import { describe, it, expect } from 'vitest';
import { EventQueue } from './event-queue.js';
import type { CliEvent } from '../types.js';

function makeEvent(content: string): CliEvent {
  return { type: 'text', timestamp: Date.now(), content, raw: content };
}

describe('EventQueue', () => {
  it('yields pushed events in order', async () => {
    const q = new EventQueue();
    q.push(makeEvent('a'));
    q.push(makeEvent('b'));
    q.push(makeEvent('c'));
    q.close();

    const results: string[] = [];
    for await (const event of q) {
      results.push(event.content!);
    }
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('completes iteration on close after push', async () => {
    const q = new EventQueue();
    q.push(makeEvent('x'));
    q.close();

    const results: string[] = [];
    for await (const event of q) {
      results.push(event.content!);
    }
    expect(results).toEqual(['x']);
  });

  it('completes immediately when closed empty', async () => {
    const q = new EventQueue();
    q.close();

    const results: CliEvent[] = [];
    for await (const event of q) {
      results.push(event);
    }
    expect(results).toEqual([]);
  });

  it('throws on error()', async () => {
    const q = new EventQueue();
    q.error(new Error('boom'));

    await expect(async () => {
      for await (const _ of q) {
        // should not reach here
      }
    }).rejects.toThrow('boom');
  });

  it('discards events after break (return)', async () => {
    const q = new EventQueue();
    q.push(makeEvent('1'));
    q.push(makeEvent('2'));
    q.push(makeEvent('3'));

    const results: string[] = [];
    for await (const event of q) {
      results.push(event.content!);
      if (event.content === '1') break;
    }
    expect(results).toEqual(['1']);

    // After break, push is discarded
    q.push(makeEvent('4'));
    // Queue is closed, iterating again yields nothing
    const after: CliEvent[] = [];
    for await (const event of q) {
      after.push(event);
    }
    expect(after).toEqual([]);
  });

  it('resolves immediately when consumer is already waiting', async () => {
    const q = new EventQueue();

    // Start consuming before pushing — consumer will await
    const iterPromise = (async () => {
      const results: string[] = [];
      for await (const event of q) {
        results.push(event.content!);
      }
      return results;
    })();

    // Push after a microtask to ensure consumer is waiting
    await Promise.resolve();
    q.push(makeEvent('hello'));
    q.close();

    const results = await iterPromise;
    expect(results).toEqual(['hello']);
  });
});
