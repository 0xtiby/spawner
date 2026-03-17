import type { CliEvent, CliError, DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';
import { classifyErrorDefault } from '../core/errors.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

export const codexAdapter: CliAdapter = {
  name: 'codex',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('codex', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      return { installed: true, version: null, authenticated: false, binaryPath: 'codex' };
    }

    const version = versionResult.stdout || null;

    const authResult = await execCommand('codex', ['login', 'status']);
    const authenticated = isExecResult(authResult) && authResult.exitCode === 0;

    return { installed: true, version, authenticated, binaryPath: 'codex' };
  },

  buildCommand(options: SpawnOptions) {
    const isFork = options.forkSession && options.sessionId;
    const isResumeById = options.sessionId && !options.forkSession;
    const isResumeLast = !options.sessionId && options.continueSession;

    const args: string[] = [];
    let stdinInput: string | undefined = options.prompt;

    if (isFork) {
      args.push('fork', options.sessionId!);
      stdinInput = undefined;
    } else if (isResumeById) {
      args.push('exec', '--json', 'resume', options.sessionId!);
    } else if (isResumeLast) {
      args.push('exec', '--json', 'resume', '--last');
    } else {
      args.push('exec', '--json');
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.autoApprove) {
      args.push('--full-auto');
    }

    if (options.addDirs) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir);
      }
    }

    if (options.ephemeral) {
      args.push('--ephemeral');
    }

    if (options.effort) {
      args.push('-c', `model_reasoning_effort=${options.effort}`);
    }

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return { bin: 'codex', args, stdinInput };
  },

  parseLine(line: string, accumulator: SessionAccumulator): CliEvent[] {
    if (!line.trim()) return [];

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line);
    } catch {
      return [{ type: 'system', content: line, timestamp: Date.now(), raw: line }];
    }

    const now = Date.now();

    switch (json.type) {
      case 'thread.started': {
        accumulator.sessionId = (json.thread_id as string) ?? accumulator.sessionId;
        return [{ type: 'system', content: 'thread.started', timestamp: now, raw: line }];
      }

      case 'turn.started':
        return [{ type: 'system', content: 'turn.started', timestamp: now, raw: line }];

      case 'item.started': {
        const item = json.item as Record<string, unknown> | undefined;
        if (item?.type === 'command_execution') {
          return [{
            type: 'tool_use',
            tool: { name: 'command_execution', input: { command: item.command as string } },
            timestamp: now,
            raw: line,
          }];
        }
        return [];
      }

      case 'item.completed': {
        const item = json.item as Record<string, unknown> | undefined;
        if (item?.type === 'command_execution') {
          return [{
            type: 'tool_result',
            toolResult: {
              name: 'command_execution',
              output: (item.aggregated_output as string) ?? '',
              error: (item.exit_code as number) !== 0 ? ((item.aggregated_output as string) ?? 'command failed') : undefined,
            },
            timestamp: now,
            raw: line,
          }];
        }
        if (item?.type === 'agent_message') {
          return [{ type: 'text', content: (item.text as string) ?? '', timestamp: now, raw: line }];
        }
        if (item?.type === 'reasoning') {
          return []; // reasoning events are internal, don't surface
        }
        return [];
      }

      case 'turn.completed': {
        const usage = json.usage as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } | undefined;
        accumulator.inputTokens += usage?.input_tokens ?? 0;
        accumulator.outputTokens += usage?.output_tokens ?? 0;
        return [{ type: 'system', content: 'turn.completed', timestamp: now, raw: line }];
      }

      case 'error':
        return [{
          type: 'error',
          content: (json.message as string) ?? (json.error as string) ?? 'unknown error',
          timestamp: now,
          raw: line,
        }];

      default:
        return [{ type: 'system', content: line, timestamp: now, raw: line }];
    }
  },

  classifyError(exitCode: number, stderr: string, stdout: string): CliError {
    // Codex-specific: non-zero exit + empty/minimal output → permission_denied
    // This heuristic catches processes killed while waiting for stdin approval
    if (exitCode !== 0 && !stderr.trim() && !stdout.trim()) {
      return {
        code: 'permission_denied',
        message: `Process exited with code ${exitCode} (no output — likely killed awaiting approval)`,
        retryable: false,
        retryAfterMs: null,
        raw: '',
      };
    }

    // Fall through to shared patterns + default classification
    return classifyErrorDefault(exitCode, stderr, stdout);
  },
};
