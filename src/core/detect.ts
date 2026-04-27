import { spawn } from 'node:child_process';
import type { CliName, DetectResult } from '../types.js';
import { getAdapter } from '../adapters/index.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ExecError = { kind: 'enoent' } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

const DEFAULT_TIMEOUT_MS = 10_000;

export function execCommand(
  bin: string,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExecResult | ExecError> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        resolve({ kind: 'enoent' });
      } else {
        resolve({ kind: 'error', error: err });
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ kind: 'timeout' });
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
      }
    });
  });
}

export async function detect(cli: CliName): Promise<DetectResult> {
  try {
    const adapter = getAdapter(cli);
    return await adapter.detect();
  } catch {
    return { installed: false, version: null, authenticated: false, binaryPath: null };
  }
}

export async function detectAll(): Promise<Record<CliName, DetectResult>> {
  const clis: CliName[] = ['claude', 'codex', 'opencode', 'pi'];
  const results = await Promise.all(clis.map((cli) => detect(cli)));
  return {
    claude: results[0],
    codex: results[1],
    opencode: results[2],
    pi: results[3],
  };
}
