import { spawn as cpSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { SpawnOptions, CliProcess, CliResult, CliEvent } from '../types.js';
import { getAdapter } from '../adapters/index.js';
import { createStream } from './stream.js';
import { EventQueue } from './event-queue.js';
import { createDebugLogger } from './debug.js';

export function spawn(options: SpawnOptions): CliProcess {
  const adapter = getAdapter(options.cli);
  const { bin, args, stdinInput } = adapter.buildCommand(options);
  const startTime = Date.now();
  const log = createDebugLogger(options.verbose);

  log?.(`spawn: ${bin} ${args.join(' ')}`);

  const queue = new EventQueue();

  // Pre-check cwd existence — on macOS, bad cwd produces same ENOENT as bad binary
  if (!existsSync(options.cwd)) {
    const cliError = {
      code: 'fatal' as const,
      message: 'working directory not found',
      retryable: false,
      retryAfterMs: null,
      raw: `ENOENT: ${options.cwd}`,
    };
    const result: CliResult = {
      exitCode: -1,
      sessionId: null,
      usage: null,
      model: null,
      error: cliError,
      durationMs: 0,
    };
    const rejection = Promise.reject(result);
    queue.error(new Error(cliError.message));
    return {
      pid: -1,
      events: queue,
      interrupt: () => rejection.catch((r) => r),
      done: rejection,
    };
  }

  const child = cpSpawn(bin, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Write stdin and close
  if (stdinInput !== undefined) {
    child.stdin.write(stdinInput);
  }
  child.stdin.end();

  // Wire stream parsing
  const { events: streamEvents, result: streamResult } = createStream({
    stdout: child.stdout,
    stderr: child.stderr,
    adapter,
    verbose: options.verbose,
  });

  // Pipe stream events into the queue (continues even if consumer abandons iterator)
  const pipePromise = (async () => {
    for await (const event of streamEvents) {
      if (log) {
        if (event.type === 'system') {
          log(`stderr: ${event.content}`);
        } else {
          if (event.raw) log(`raw: ${event.raw}`);
          log(`event: ${event.type} (${event.content?.length ?? 0} chars)`);
        }
      }
      if (!queue.abandoned) {
        queue.push(event);
      }
    }
  })();

  let doneResult: CliResult | undefined;

  const done = new Promise<CliResult>((resolve, reject) => {
    // Handle spawn errors (ENOENT, bad cwd)
    child.on('error', (err: NodeJS.ErrnoException) => {
      const isCwdError = err.code === 'ENOENT' && err.syscall === 'chdir';
      const isBinaryNotFound = err.code === 'ENOENT' && !isCwdError;
      const cliError = {
        code: isBinaryNotFound ? 'binary_not_found' as const : 'fatal' as const,
        message: isCwdError
          ? 'working directory not found'
          : isBinaryNotFound
            ? `Binary not found: ${bin}`
            : err.message,
        retryable: false,
        retryAfterMs: null,
        raw: err.message,
      };

      const result: CliResult = {
        exitCode: -1,
        sessionId: null,
        usage: null,
        model: null,
        error: cliError,
        durationMs: Date.now() - startTime,
      };

      doneResult = result;
      queue.error(new Error(cliError.message));
      reject(result);
    });

    child.on('close', async (exitCode) => {
      const code = exitCode ?? 1;

      // Wait for stream parsing to finish
      await pipePromise;
      const { accumulator, stderr } = await streamResult;

      log?.(`exit: code=${code} duration=${Date.now() - startTime}ms`);

      const error = code !== 0 ? adapter.classifyError(code, stderr, '') : null;

      const result: CliResult = {
        exitCode: code,
        sessionId: accumulator.sessionId,
        usage: {
          inputTokens: accumulator.inputTokens,
          outputTokens: accumulator.outputTokens,
          totalTokens: accumulator.inputTokens + accumulator.outputTokens,
          cost: accumulator.cost,
        },
        model: accumulator.model,
        error,
        durationMs: Date.now() - startTime,
      };

      doneResult = result;

      // Emit done event
      const doneEvent: CliEvent = {
        type: 'done',
        timestamp: Date.now(),
        result,
        raw: '',
      };
      queue.push(doneEvent);
      queue.close();

      resolve(result);
    });
  });

  // AbortSignal handling
  if (options.abortSignal) {
    if (options.abortSignal.aborted) {
      // Signal already aborted — fire interrupt immediately
      interruptFn();
    } else {
      const onAbort = () => interruptFn();
      options.abortSignal.addEventListener('abort', onAbort, { once: true });

      // Clean up listener when process exits
      done.then(() => {
        options.abortSignal!.removeEventListener('abort', onAbort);
      }).catch(() => {
        options.abortSignal!.removeEventListener('abort', onAbort);
      });
    }
  }

  async function interruptFn(graceMs = 5000): Promise<CliResult> {
    // Already exited — no-op
    if (doneResult) {
      return doneResult;
    }

    child.kill('SIGTERM');

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, graceMs);

    const result = await done.catch((r) => r as CliResult);
    clearTimeout(timeout);
    return result;
  }

  return {
    pid: child.pid!,
    events: queue,
    interrupt: interruptFn,
    done,
  };
}
