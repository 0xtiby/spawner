import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

export interface MockProcessOptions {
  stdoutLines: string[];
  stderrLines?: string[];
  exitCode?: number;
  delay?: number;
}

export interface MockChildProcess extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid: number;
  killed: boolean;
  kill(signal?: string): boolean;
}

let nextPid = 90000;

export function createMockProcess(options: MockProcessOptions): MockChildProcess {
  const { stdoutLines, stderrLines = [], exitCode = 0, delay = 0 } = options;

  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = nextPid++;
  proc.killed = false;

  proc.kill = (signal?: string) => {
    if (proc.killed) return false;
    proc.killed = true;
    proc.emit('close', signal === 'SIGKILL' ? 137 : 143, signal ?? 'SIGTERM');
    return true;
  };

  // Feed lines asynchronously
  (async () => {
    for (const line of stdoutLines) {
      if (proc.killed) break;
      if (delay > 0) await sleep(delay);
      proc.stdout.write(line + '\n');
    }
    proc.stdout.end();

    for (const line of stderrLines) {
      proc.stderr.write(line + '\n');
    }
    proc.stderr.end();

    if (!proc.killed) {
      // Small tick to let readline process buffered lines
      await sleep(0);
      proc.emit('close', exitCode, null);
    }
  })();

  return proc;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
