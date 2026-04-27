import type { CliEvent, CliError, DetectResult, EffortLevel, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';
import { classifyErrorDefault } from '../core/errors.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

function mapEffortToThinking(effort: EffortLevel): string {
  if (effort === 'max' || effort === 'xhigh') return 'xhigh';
  return effort;
}

export const piAdapter: CliAdapter = {
  name: 'pi',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('pi', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      return { installed: true, version: null, authenticated: false, binaryPath: 'pi' };
    }

    const version = versionResult.stdout.trim() || null;

    // Pi auth is provider-specific and runtime-determined; optimistically report
    // authenticated. Real failures surface at runtime via classifyError.
    return { installed: true, version, authenticated: true, binaryPath: 'pi' };
  },

  buildCommand(options: SpawnOptions) {
    const args: string[] = ['--mode', 'json'];

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.sessionId) {
      args.push('--session', options.sessionId);
    } else if (options.continueSession) {
      args.push('--continue');
    }

    if (options.forkSession && options.sessionId) {
      const sessionIndex = args.indexOf('--session');
      if (sessionIndex !== -1) args.splice(sessionIndex, 2);
      const continueIndex = args.indexOf('--continue');
      if (continueIndex !== -1) args.splice(continueIndex, 1);
      args.push('--fork', options.sessionId);
    }

    if (options.ephemeral) {
      args.push('--no-session');
    }

    if (options.verbose) {
      args.push('--verbose');
    }

    if (options.effort) {
      args.push('--thinking', mapEffortToThinking(options.effort));
    }

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    args.push(options.prompt);

    return { bin: 'pi', args };
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
      case 'session': {
        const sessionId = (json.id as string) ?? null;
        const model = (json.model as string) ?? null;
        if (sessionId) accumulator.sessionId = sessionId;
        if (model) accumulator.model = model;
        const parts: string[] = [];
        if (sessionId) parts.push(`session=${sessionId}`);
        if (model) parts.push(`model=${model}`);
        return [{ type: 'system', content: parts.join(', ') || 'session', timestamp: now, raw: line }];
      }

      case 'agent_start':
        return [{ type: 'system', content: 'agent_start', timestamp: now, raw: line }];

      case 'turn_start':
        return [{ type: 'system', content: 'turn_start', timestamp: now, raw: line }];

      case 'message_start': {
        const message = json.message as Record<string, unknown> | undefined;
        if (message?.role === 'assistant') {
          const model = (message.model as string) ?? null;
          if (model) accumulator.model = model;
        }
        return [];
      }

      case 'message_update': {
        const assistantEvent = json.assistantMessageEvent as Record<string, unknown> | undefined;
        if (!assistantEvent) return [];

        const eventType = assistantEvent.type as string;

        if (eventType === 'text_end') {
          const content = assistantEvent.content as string;
          return [{ type: 'text', content: content ?? '', timestamp: now, raw: line }];
        }

        if (eventType === 'toolcall_end') {
          const toolCall = assistantEvent.toolCall as Record<string, unknown> | undefined;
          if (toolCall) {
            return [{
              type: 'tool_use',
              tool: {
                name: (toolCall.name as string) ?? 'unknown',
                input: (toolCall.arguments as Record<string, unknown>) ?? {},
              },
              timestamp: now,
              raw: line,
            }];
          }
        }

        if (eventType === 'error') {
          const errObj = assistantEvent.error as Record<string, unknown> | undefined;
          const errorMsg = (errObj?.errorMessage as string) ?? 'unknown error';
          return [{ type: 'error', content: errorMsg, timestamp: now, raw: line }];
        }

        // thinking_start, thinking_delta, thinking_end and other unhandled
        // assistant events are intentionally skipped.
        return [];
      }

      case 'message_end': {
        const message = json.message as Record<string, unknown> | undefined;
        if (message?.role === 'assistant') {
          const usage = message.usage as Record<string, unknown> | undefined;
          if (usage) {
            const input = usage.input as number | undefined;
            const output = usage.output as number | undefined;
            if (typeof input === 'number') accumulator.inputTokens = input;
            if (typeof output === 'number') accumulator.outputTokens = output;
            const cost = (usage.cost as Record<string, unknown> | undefined)?.total as number | undefined;
            if (typeof cost === 'number') accumulator.cost = cost;
          }

          const stopReason = message.stopReason as string | undefined;
          if (stopReason === 'error' || stopReason === 'aborted') {
            const errorMessage = (message.errorMessage as string) ?? `Request ${stopReason}`;
            return [{ type: 'error', content: errorMessage, timestamp: now, raw: line }];
          }
        }
        return [];
      }

      case 'tool_execution_start':
      case 'tool_execution_update':
        return [];

      case 'tool_execution_end': {
        const toolCallId = json.toolCallId as string | undefined;
        const toolName = json.toolName as string | undefined;
        const result = json.result as Record<string, unknown> | undefined;
        const isError = json.isError as boolean | undefined;

        const content = result?.content as Array<Record<string, unknown>> | undefined;
        const text = (content?.find((c) => c.type === 'text')?.text as string) ?? '';

        return [{
          type: 'tool_result',
          toolResult: {
            name: toolName ?? toolCallId ?? 'unknown',
            output: text,
            error: isError ? text || 'tool execution failed' : undefined,
          },
          timestamp: now,
          raw: line,
        }];
      }

      case 'turn_end': {
        const message = json.message as Record<string, unknown> | undefined;
        if (message) {
          const model = (message.model as string) ?? null;
          if (model) accumulator.model = model;

          const usage = message.usage as Record<string, unknown> | undefined;
          if (usage) {
            const input = usage.input as number | undefined;
            const output = usage.output as number | undefined;
            if (typeof input === 'number') accumulator.inputTokens = input;
            if (typeof output === 'number') accumulator.outputTokens = output;
            const cost = (usage.cost as Record<string, unknown> | undefined)?.total as number | undefined;
            if (typeof cost === 'number') accumulator.cost = cost;
          }

          const stopReason = message.stopReason as string | undefined;
          if (stopReason === 'error' || stopReason === 'aborted') {
            const errorMessage = (message.errorMessage as string) ?? `Request ${stopReason}`;
            return [{ type: 'error', content: errorMessage, timestamp: now, raw: line }];
          }
        }
        return [{ type: 'system', content: 'turn_end', timestamp: now, raw: line }];
      }

      case 'agent_end':
        return [{ type: 'system', content: 'agent_end', timestamp: now, raw: line }];

      default:
        return [{ type: 'system', content: line, timestamp: now, raw: line }];
    }
  },

  classifyError(exitCode: number, stderr: string, stdout: string): CliError {
    const combined = stderr + '\n' + stdout;
    const raw = stderr + (stdout ? '\n' + stdout : '');

    if (/model.*not found|not found.*model|unknown model/i.test(combined)) {
      const matchedLine = combined.split('\n').find((l) => /model.*not found|not found.*model|unknown model/i.test(l))?.trim() || 'Model not found';
      return { code: 'model_not_found', message: matchedLine, retryable: false, retryAfterMs: null, raw };
    }

    if (/api key|unauthorized|authentication/i.test(combined)) {
      const matchedLine = combined.split('\n').find((l) => /api key|unauthorized|authentication/i.test(l))?.trim() || 'Authentication required';
      return { code: 'auth', message: matchedLine, retryable: false, retryAfterMs: null, raw };
    }

    if (/rate limit|too many requests|ratelimit/i.test(combined)) {
      const matchedLine = combined.split('\n').find((l) => /rate limit|too many requests|ratelimit/i.test(l))?.trim() || 'Rate limited';
      return { code: 'rate_limit', message: matchedLine, retryable: true, retryAfterMs: null, raw };
    }

    if (/context.*length|too long|token limit|maximum context|context window/i.test(combined)) {
      const matchedLine = combined.split('\n').find((l) => /context.*length|too long|token limit|maximum context|context window/i.test(l))?.trim() || 'Context overflow';
      return { code: 'context_overflow', message: matchedLine, retryable: false, retryAfterMs: null, raw };
    }

    return classifyErrorDefault(exitCode, stderr, stdout);
  },
};
