import type { CliName, CliError, CliErrorCode } from '../types.js';
import { getAdapter } from '../adapters/index.js';

// --- Shared pattern table (priority order — first match wins) ---

interface ErrorPattern {
  code: CliErrorCode;
  patterns: RegExp[];
  retryable: boolean;
}

const SHARED_PATTERNS: ErrorPattern[] = [
  {
    code: 'rate_limit',
    patterns: [/rate limit/i, /too many requests/i, /429/i, /try again/i, /overloaded/i],
    retryable: true,
  },
  {
    code: 'auth',
    patterns: [/not authenticated/i, /\blogin\b/i, /sign in/i, /401/i, /unauthorized/i, /\bauth\b/i],
    retryable: false,
  },
  {
    code: 'session_not_found',
    patterns: [/session not found/i, /no such session/i, /invalid session/i],
    retryable: false,
  },
  {
    code: 'model_not_found',
    patterns: [/model not found/i, /unknown model/i, /invalid model/i],
    retryable: false,
  },
  {
    code: 'context_overflow',
    patterns: [/context length/i, /too long/i, /token limit/i, /context window/i],
    retryable: false,
  },
  {
    code: 'permission_denied',
    patterns: [/permission/i, /approve/i, /confirm/i],
    retryable: false,
  },
];

// --- Retry-after parsing ---

export function parseRetryAfterMs(text: string): number {
  const match = text.match(/(?:retry|try|wait).*?(\d+)\s*(?:s(?:ec(?:ond)?s?)?)/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return 60_000;
}

// --- Shared pattern matcher (reusable by adapters) ---

export function matchSharedPatterns(
  stderr: string,
  stdout: string,
): { code: CliErrorCode; retryable: boolean; matchedLine: string } | null {
  const combined = stderr + '\n' + stdout;

  for (const entry of SHARED_PATTERNS) {
    for (const regex of entry.patterns) {
      const match = combined.match(regex);
      if (match) {
        // Extract the line containing the match for the message
        const lines = combined.split('\n');
        const matchedLine = lines.find((line) => regex.test(line))?.trim() || match[0];
        return { code: entry.code, retryable: entry.retryable, matchedLine };
      }
    }
  }

  return null;
}

// --- Core classifyError ---

export function classifyError(
  cli: CliName,
  exitCode: number,
  stderr: string,
  stdout: string,
): CliError {
  const adapter = getAdapter(cli);
  return adapter.classifyError(exitCode, stderr, stdout);
}

// --- Default classification (for adapters to use) ---

export function classifyErrorDefault(
  exitCode: number,
  stderr: string,
  stdout: string,
): CliError {
  const raw = stderr + (stdout ? '\n' + stdout : '');
  const matched = matchSharedPatterns(stderr, stdout);

  if (matched) {
    return {
      code: matched.code,
      message: matched.matchedLine,
      retryable: matched.retryable,
      retryAfterMs: matched.code === 'rate_limit' ? parseRetryAfterMs(raw) : null,
      raw,
    };
  }

  if (exitCode !== 0) {
    return {
      code: 'fatal',
      message: stderr.split('\n').find((l) => l.trim())?.trim() || `Process exited with code ${exitCode}`,
      retryable: false,
      retryAfterMs: null,
      raw,
    };
  }

  return {
    code: 'unknown',
    message: 'Unknown error',
    retryable: false,
    retryAfterMs: null,
    raw,
  };
}
