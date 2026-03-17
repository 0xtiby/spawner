import type { CliEvent, CliError, DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';
import { classifyErrorDefault } from '../core/errors.js';

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
    const part = (json.part ?? {}) as Record<string, unknown>;
    const state = (part.state ?? {}) as Record<string, unknown>;

    switch (json.type) {
      case 'text':
        return [{ type: 'text', content: (part.text as string) ?? '', timestamp: now, raw: line }];

      case 'tool_use': {
        const events: CliEvent[] = [{
          type: 'tool_use',
          tool: { name: (part.tool as string) ?? (part.callID as string), input: (state.input as Record<string, unknown>) ?? {} },
          timestamp: now,
          raw: line,
        }];
        // OpenCode combines tool_use and tool_result in a single event when completed
        if (state.status === 'completed' || state.status === 'error') {
          events.push({
            type: 'tool_result',
            toolResult: {
              name: (part.tool as string) ?? (part.callID as string),
              output: (state.output as string) ?? '',
              error: state.status === 'error' ? ((state.output as string) ?? 'tool error') : undefined,
            },
            timestamp: now,
            raw: line,
          });
        }
        return events;
      }

      case 'step_start':
        return [{ type: 'system', content: 'step_start', timestamp: now, raw: line }];

      case 'step_finish': {
        accumulator.sessionId = (json.sessionID as string) ?? accumulator.sessionId;
        const tokens = (part.tokens ?? {}) as Record<string, number>;
        accumulator.inputTokens += tokens.input ?? 0;
        accumulator.outputTokens += tokens.output ?? 0;
        accumulator.cost = (part.cost as number) ?? accumulator.cost;
        return [{ type: 'system', content: 'step_finish', timestamp: now, raw: line }];
      }

      case 'error':
        return [{ type: 'error', content: (json.message as string) ?? (json.error as string) ?? 'unknown error', timestamp: now, raw: line }];

      default:
        return [{ type: 'system', content: line, timestamp: now, raw: line }];
    }
  },

  classifyError(exitCode: number, stderr: string, stdout: string): CliError {
    return classifyErrorDefault(exitCode, stderr, stdout);
  },
};
