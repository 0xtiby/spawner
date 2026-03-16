import type { CliEvent, DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';

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
      args.push('exec', 'resume', options.sessionId!);
    } else if (isResumeLast) {
      args.push('exec', 'resume', '--last');
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
      case 'item.started': {
        const item = json.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse((item.arguments as string) ?? '{}');
          } catch {
            // malformed arguments — fall back to empty object
          }
          return [{
            type: 'tool_use',
            tool: { name: item.name as string, input },
            timestamp: now,
            raw: line,
          }];
        }
        return [];
      }

      case 'item.completed': {
        const item = json.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call_output') {
          return [{
            type: 'tool_result',
            toolResult: {
              name: item.call_id as string,
              output: item.output as string,
              error: item.status === 'error' ? (item.output as string) : undefined,
            },
            timestamp: now,
            raw: line,
          }];
        }
        if (item?.type === 'message' && item.role === 'assistant') {
          const events: CliEvent[] = [];
          const content = (item.content as Array<Record<string, unknown>>) ?? [];
          for (const block of content) {
            if (block.type === 'output_text') {
              events.push({ type: 'text', content: block.text as string, timestamp: now, raw: line });
            }
          }
          return events;
        }
        return [];
      }

      case 'response.completed': {
        const response = json.response as Record<string, unknown> | undefined;
        const usage = response?.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        accumulator.inputTokens += usage?.input_tokens ?? 0;
        accumulator.outputTokens += usage?.output_tokens ?? 0;
        return [];
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

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('codex adapter classifyError not implemented');
  },
};
