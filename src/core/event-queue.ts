import type { CliEvent } from '../types.js';

export class EventQueue implements AsyncIterable<CliEvent> {
  private buffer: CliEvent[] = [];
  private waiting: ((value: IteratorResult<CliEvent>) => void) | null = null;
  private closed = false;
  private err: Error | null = null;
  abandoned = false;

  push(event: CliEvent): void {
    if (this.closed || this.abandoned) return;

    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined as unknown as CliEvent, done: true });
    }
  }

  error(err: Error): void {
    this.err = err;
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      // Signal error by storing it; next() will throw
      resolve({ value: undefined as unknown as CliEvent, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CliEvent> {
    return {
      next: (): Promise<IteratorResult<CliEvent>> => {
        if (this.err) {
          const err = this.err;
          this.err = null;
          return Promise.reject(err);
        }

        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }

        if (this.closed || this.abandoned) {
          return Promise.resolve({ value: undefined as unknown as CliEvent, done: true });
        }

        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },

      return: (): Promise<IteratorResult<CliEvent>> => {
        this.abandoned = true;
        this.buffer.length = 0;
        this.waiting = null;
        return Promise.resolve({ value: undefined as unknown as CliEvent, done: true });
      },
    };
  }
}
