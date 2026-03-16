import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { CliEvent } from '../types.js';
import type { CliAdapter, SessionAccumulator } from '../adapters/types.js';
import { createAccumulator } from '../adapters/types.js';

export interface StreamOptions {
  stdout: Readable;
  stderr: Readable;
  adapter: CliAdapter;
  verbose?: boolean;
}

export interface StreamResult {
  events: AsyncIterable<CliEvent>;
  result: Promise<{ accumulator: SessionAccumulator; stderr: string }>;
}

export function createStream(options: StreamOptions): StreamResult {
  const { stdout, stderr, adapter, verbose = false } = options;
  const accumulator = createAccumulator();
  let stderrBuffer = '';

  let resolveResult: (value: { accumulator: SessionAccumulator; stderr: string }) => void;
  const resultPromise = new Promise<{ accumulator: SessionAccumulator; stderr: string }>((resolve) => {
    resolveResult = resolve;
  });

  const rl = createInterface({ input: stdout });

  // Buffer stderr and optionally emit system events
  const stderrChunks: string[] = [];
  let stderrLineBuffer = '';

  stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrChunks.push(text);

    if (verbose) {
      // Split on newlines, buffering partial lines
      stderrLineBuffer += text;
      const lines = stderrLineBuffer.split('\n');
      // Last element is either empty (line ended with \n) or a partial line
      stderrLineBuffer = lines.pop()!;
      for (const line of lines) {
        if (line) {
          stderrEvents.push({
            type: 'system',
            content: line,
            timestamp: Date.now(),
            raw: line,
          });
          notifyEvent();
        }
      }
    }
  });

  stderr.on('end', () => {
    if (verbose && stderrLineBuffer) {
      stderrEvents.push({
        type: 'system',
        content: stderrLineBuffer,
        timestamp: Date.now(),
        raw: stderrLineBuffer,
      });
      stderrLineBuffer = '';
      notifyEvent();
    }
  });

  // Event queue for AsyncIterable
  const eventQueue: CliEvent[] = [];
  const stderrEvents: CliEvent[] = [];
  let done = false;
  let waitResolve: (() => void) | null = null;

  function notifyEvent() {
    if (waitResolve) {
      const resolve = waitResolve;
      waitResolve = null;
      resolve();
    }
  }

  rl.on('line', (line: string) => {
    const events = adapter.parseLine(line, accumulator);
    for (const event of events) {
      event.timestamp = Date.now();
      eventQueue.push(event);
    }
    notifyEvent();
  });

  rl.on('close', () => {
    stderrBuffer = stderrChunks.join('');
    done = true;
    resolveResult!({ accumulator, stderr: stderrBuffer });
    notifyEvent();
  });

  async function* generateEvents(): AsyncIterable<CliEvent> {
    while (true) {
      // Drain stderr events first (interleaved in order)
      while (stderrEvents.length > 0) {
        yield stderrEvents.shift()!;
      }

      // Drain stdout-parsed events
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      if (done && eventQueue.length === 0 && stderrEvents.length === 0) {
        return;
      }

      // Wait for more events
      await new Promise<void>((resolve) => {
        waitResolve = resolve;
      });
    }
  }

  return {
    events: generateEvents(),
    result: resultPromise,
  };
}
