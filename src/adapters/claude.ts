import type { CliEvent, CliError, DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';
import { matchSharedPatterns, parseRetryAfterMs, classifyErrorDefault } from '../core/errors.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

export const claudeAdapter: CliAdapter = {
  name: 'claude',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('claude', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      // timeout or other error — binary exists but didn't respond
      return { installed: true, version: null, authenticated: false, binaryPath: 'claude' };
    }

    const version = versionResult.stdout || null;

    const authResult = await execCommand('claude', ['auth', 'status']);
    const authenticated = isExecResult(authResult) && authResult.exitCode === 0;

    return { installed: true, version, authenticated, binaryPath: 'claude' };
  },

  buildCommand(options: SpawnOptions) {
    const args: string[] = ['--print', '--output-format', 'stream-json', '--verbose'];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Session logic: sessionId takes precedence over continueSession
    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    } else if (options.continueSession) {
      args.push('--continue');
    }

    // forkSession is additive — only applies when sessionId or continueSession is set
    if (options.forkSession && (options.sessionId || options.continueSession)) {
      args.push('--fork-session');
    }

    if (options.effort) {
      args.push('--effort', options.effort);
    }

    if (options.autoApprove) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.addDirs) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir);
      }
    }

    if (options.ephemeral) {
      args.push('--no-session-persistence');
    }

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return { bin: 'claude', args, stdinInput: options.prompt };
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
      case 'system': {
        accumulator.sessionId = (json.session_id as string) ?? accumulator.sessionId;
        accumulator.model = (json.model as string) ?? accumulator.model;
        const parts: string[] = [];
        if (json.session_id) parts.push(`session=${json.session_id}`);
        if (json.model) parts.push(`model=${json.model}`);
        return [{ type: 'system', content: parts.join(', ') || 'system', timestamp: now, raw: line }];
      }

      case 'assistant': {
        const events: CliEvent[] = [];
        const message = json.message as { content?: Array<Record<string, unknown>> } | undefined;
        const blocks = message?.content ?? [];
        for (const block of blocks) {
          if (block.type === 'text') {
            events.push({ type: 'text', content: block.text as string, timestamp: now, raw: line });
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool_use',
              tool: { name: block.name as string, input: block.input as Record<string, unknown> },
              timestamp: now,
              raw: line,
            });
          } else if (block.type === 'tool_result') {
            events.push({
              type: 'tool_result',
              toolResult: {
                name: block.name as string,
                output: block.content as string,
                error: block.is_error ? (block.content as string) : undefined,
              },
              timestamp: now,
              raw: line,
            });
          }
        }
        return events;
      }

      case 'result': {
        accumulator.sessionId = (json.session_id as string) ?? accumulator.sessionId;
        accumulator.model = (json.model as string) ?? accumulator.model;
        const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        accumulator.inputTokens += usage?.input_tokens ?? 0;
        accumulator.outputTokens += usage?.output_tokens ?? 0;
        accumulator.cost = (json.cost_usd as number) ?? accumulator.cost;
        return [];
      }

      default:
        return [{ type: 'system', content: line, timestamp: now, raw: line }];
    }
  },

  classifyError(exitCode: number, stderr: string, stdout: string): CliError {
    const combined = stderr + '\n' + stdout;

    // Claude-specific: exit code 1 + auth keywords → auth error
    if (exitCode === 1 && /\b(?:login|auth)\b/i.test(combined)) {
      const raw = stderr + (stdout ? '\n' + stdout : '');
      const matchedLine = combined.split('\n').find((l) => /\b(?:login|auth)\b/i.test(l))?.trim() || 'Authentication required';
      return {
        code: 'auth',
        message: matchedLine,
        retryable: false,
        retryAfterMs: null,
        raw,
      };
    }

    // Fall through to shared patterns + default classification
    return classifyErrorDefault(exitCode, stderr, stdout);
  },
};
