import type { CliEvent, DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('opencode', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      return { installed: true, version: null, authenticated: false, binaryPath: 'opencode' };
    }

    const version = versionResult.stdout || null;

    const authResult = await execCommand('opencode', ['auth', 'list']);
    const authenticated = isExecResult(authResult) && authResult.stdout.trim().length > 0;

    return { installed: true, version, authenticated, binaryPath: 'opencode' };
  },

  buildCommand(options: SpawnOptions) {
    const args: string[] = ['run', '--format', 'json'];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Session logic: sessionId takes precedence over continueSession
    if (options.sessionId) {
      args.push('--session', options.sessionId);
    } else if (options.continueSession) {
      args.push('--continue');
    }

    // forkSession is additive — only applies when sessionId or continueSession is set
    if (options.forkSession && (options.sessionId || options.continueSession)) {
      args.push('--fork');
    }

    // Unsupported options silently ignored: autoApprove, addDirs, ephemeral, effort

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return { bin: 'opencode', args, stdinInput: options.prompt };
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
      case 'text':
        return [{ type: 'text', content: (json.content as string) ?? (json.text as string), timestamp: now, raw: line }];

      case 'tool_use':
        return [{
          type: 'tool_use',
          tool: { name: json.name as string, input: (json.input as Record<string, unknown>) ?? {} },
          timestamp: now,
          raw: line,
        }];

      case 'tool_result':
        return [{
          type: 'tool_result',
          toolResult: {
            name: json.name as string,
            output: json.output as string,
            error: json.is_error ? (json.output as string) : undefined,
          },
          timestamp: now,
          raw: line,
        }];

      case 'step_finish': {
        accumulator.sessionId = (json.session_id as string) ?? accumulator.sessionId;
        accumulator.model = (json.model as string) ?? accumulator.model;
        const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        accumulator.inputTokens += usage?.input_tokens ?? 0;
        accumulator.outputTokens += usage?.output_tokens ?? 0;
        accumulator.cost = (json.cost as number) ?? accumulator.cost;
        return [{ type: 'system', content: 'step_finish', timestamp: now, raw: line }];
      }

      case 'error':
        return [{ type: 'error', content: (json.message as string) ?? (json.error as string) ?? 'unknown error', timestamp: now, raw: line }];

      default:
        return [{ type: 'system', content: line, timestamp: now, raw: line }];
    }
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('opencode adapter classifyError not implemented');
  },
};
