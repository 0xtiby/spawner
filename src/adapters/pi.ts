import type { CliEvent, CliError, DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';
import { classifyErrorDefault } from '../core/errors.js';
import { mapEffortToCliFlag } from '../core/effort.js';

const UNKNOWN_ERROR = 'unknown error';
const UNKNOWN_TOOL = 'unknown';
const TOOL_FAILURE_FALLBACK = 'tool execution failed';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
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
      const mapped = mapEffortToCliFlag('pi', options.effort);
      if (mapped) args.push(mapped.flag, mapped.value);
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
        const sessionId = asString(json.id);
        const model = asString(json.model);
        if (sessionId) accumulator.sessionId = sessionId;
        if (model) accumulator.model = model;
        const parts: string[] = [];
        if (sessionId) parts.push(`session=${sessionId}`);
        if (model) parts.push(`model=${model}`);
        // If neither id nor model are present the event carries no useful state
        // for downstream consumers — drop it rather than emit a placeholder.
        if (parts.length === 0) return [];
        return [{ type: 'system', content: parts.join(', '), timestamp: now, raw: line }];
      }

      case 'agent_start':
        return [{ type: 'system', content: 'agent_start', timestamp: now, raw: line }];

      case 'turn_start':
        return [{ type: 'system', content: 'turn_start', timestamp: now, raw: line }];

      case 'message_start': {
        // Pi can switch models mid-session via --models cycling, so we refresh
        // accumulator.model here in addition to the initial `session` event.
        const message = asRecord(json.message);
        if (message?.role === 'assistant') {
          const model = asString(message.model);
          if (model) accumulator.model = model;
        }
        return [];
      }

      case 'message_update': {
        const assistantEvent = asRecord(json.assistantMessageEvent);
        if (!assistantEvent) return [];

        const eventType = asString(assistantEvent.type);

        if (eventType === 'text_end') {
          const content = asString(assistantEvent.content);
          return [{ type: 'text', content: content ?? '', timestamp: now, raw: line }];
        }

        if (eventType === 'toolcall_end') {
          const toolCall = asRecord(assistantEvent.toolCall);
          if (toolCall) {
            return [{
              type: 'tool_use',
              tool: {
                name: asString(toolCall.name) ?? UNKNOWN_TOOL,
                input: asRecord(toolCall.arguments) ?? {},
              },
              timestamp: now,
              raw: line,
            }];
          }
        }

        if (eventType === 'error') {
          const errObj = asRecord(assistantEvent.error);
          const errorMsg = asString(errObj?.errorMessage) ?? UNKNOWN_ERROR;
          return [{ type: 'error', content: errorMsg, timestamp: now, raw: line }];
        }

        // thinking_start, thinking_delta, thinking_end and other unhandled
        // assistant events are intentionally skipped.
        return [];
      }

      case 'message_end': {
        // Usage is intentionally ignored here — pi emits the same usage block
        // again in turn_end, and may emit multiple message_end events per turn
        // (some with null usage). We accumulate only at turn_end to have a
        // single source of truth that works correctly across multi-turn sessions.
        const message = asRecord(json.message);
        if (message?.role === 'assistant') {
          const stopReason = asString(message.stopReason);
          if (stopReason === 'error' || stopReason === 'aborted') {
            const errorMessage = asString(message.errorMessage) ?? `Request ${stopReason}`;
            return [{ type: 'error', content: errorMessage, timestamp: now, raw: line }];
          }
        }
        return [];
      }

      // Skipped — tool_execution_end carries the final result we surface.
      case 'tool_execution_start':
      case 'tool_execution_update':
        return [];

      case 'tool_execution_end': {
        const toolName = asString(json.toolName);
        const result = asRecord(json.result);
        const isError = json.isError === true;

        const content = Array.isArray(result?.content) ? (result.content as Array<Record<string, unknown>>) : undefined;
        const text = asString(content?.find((c) => c.type === 'text')?.text) ?? '';

        // When isError is true, pi exposes the failure text only via result.content,
        // so we surface the same string in both `output` (raw payload) and `error`
        // (failure marker). Consumers should branch on `error` being defined.
        return [{
          type: 'tool_result',
          toolResult: {
            name: toolName ?? UNKNOWN_TOOL,
            output: text,
            error: isError ? text || TOOL_FAILURE_FALLBACK : undefined,
          },
          timestamp: now,
          raw: line,
        }];
      }

      case 'turn_end': {
        const message = asRecord(json.message);
        if (message) {
          const model = asString(message.model);
          if (model) accumulator.model = model;

          // pi reports per-turn usage (verified empirically across two-turn
          // sessions), so we accumulate to track session totals — matching
          // claude/codex semantics.
          const usage = asRecord(message.usage);
          if (usage) {
            const input = usage.input;
            const output = usage.output;
            if (typeof input === 'number') accumulator.inputTokens += input;
            if (typeof output === 'number') accumulator.outputTokens += output;
            const cost = asRecord(usage.cost)?.total;
            if (typeof cost === 'number') accumulator.cost = (accumulator.cost ?? 0) + cost;
          }

          const stopReason = asString(message.stopReason);
          if (stopReason === 'error' || stopReason === 'aborted') {
            const errorMessage = asString(message.errorMessage) ?? `Request ${stopReason}`;
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
    const raw = [stderr, stdout].filter(Boolean).join('\n');

    const PATTERNS = [
      { code: 'model_not_found' as const, regex: /model.*not found|not found.*model|unknown model/i, retryable: false, fallback: 'Model not found' },
      { code: 'auth' as const,            regex: /api key|unauthorized|authentication/i,             retryable: false, fallback: 'Authentication required' },
      { code: 'rate_limit' as const,      regex: /rate limit|too many requests|ratelimit/i,          retryable: true,  fallback: 'Rate limited' },
      { code: 'context_overflow' as const,regex: /context.*length|too long|token limit|maximum context|context window/i, retryable: false, fallback: 'Context overflow' },
    ];

    for (const { code, regex, retryable, fallback } of PATTERNS) {
      const matchedLine = raw.split('\n').find((l) => regex.test(l))?.trim();
      if (matchedLine !== undefined) {
        return { code, message: matchedLine || fallback, retryable, retryAfterMs: null, raw };
      }
    }

    return classifyErrorDefault(exitCode, stderr, stdout);
  },
};
