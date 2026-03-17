import { describe, it, expect, vi } from 'vitest';
import { parseRetryAfterMs, matchSharedPatterns, classifyError, classifyErrorDefault } from './errors.js';

// --- parseRetryAfterMs ---

describe('parseRetryAfterMs', () => {
  it('parses "retry after N seconds"', () => {
    expect(parseRetryAfterMs('rate limit exceeded, retry after 30 seconds')).toBe(30_000);
  });

  it('parses "try again in Ns"', () => {
    expect(parseRetryAfterMs('too many requests, try again in 45s')).toBe(45_000);
  });

  it('parses "wait N seconds"', () => {
    expect(parseRetryAfterMs('please wait 10 seconds before retrying')).toBe(10_000);
  });

  it('parses "retry after N secs"', () => {
    expect(parseRetryAfterMs('retry after 120 secs')).toBe(120_000);
  });

  it('defaults to 60000 when no numeric hint found', () => {
    expect(parseRetryAfterMs('rate limit exceeded')).toBe(60_000);
  });

  it('defaults to 60000 for empty string', () => {
    expect(parseRetryAfterMs('')).toBe(60_000);
  });
});

// --- matchSharedPatterns ---

describe('matchSharedPatterns', () => {
  it('matches rate_limit in stderr', () => {
    const result = matchSharedPatterns('rate limit exceeded', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('rate_limit');
    expect(result!.retryable).toBe(true);
  });

  it('matches auth in stderr', () => {
    const result = matchSharedPatterns('not authenticated', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('auth');
    expect(result!.retryable).toBe(false);
  });

  it('matches session_not_found', () => {
    const result = matchSharedPatterns('session not found', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('session_not_found');
  });

  it('matches model_not_found', () => {
    const result = matchSharedPatterns('model not found: gpt-99', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('model_not_found');
  });

  it('matches context_overflow', () => {
    const result = matchSharedPatterns('context length exceeded', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('context_overflow');
  });

  it('matches permission_denied', () => {
    const result = matchSharedPatterns('permission denied', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('permission_denied');
  });

  it('matches in stdout when stderr is empty', () => {
    const result = matchSharedPatterns('', 'too many requests');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('rate_limit');
  });

  it('returns first match in priority order (rate_limit before auth)', () => {
    const result = matchSharedPatterns('rate limit, not authenticated', '');
    expect(result!.code).toBe('rate_limit');
  });

  it('returns null when no patterns match', () => {
    expect(matchSharedPatterns('something went wrong', '')).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = matchSharedPatterns('RATE LIMIT EXCEEDED', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('rate_limit');
  });

  it('extracts the matching line for message', () => {
    const result = matchSharedPatterns('line one\nrate limit exceeded\nline three', '');
    expect(result!.matchedLine).toBe('rate limit exceeded');
  });
});

// --- classifyErrorDefault ---

describe('classifyErrorDefault', () => {
  it('returns rate_limit with retryAfterMs for rate limit errors', () => {
    const err = classifyErrorDefault(1, 'rate limit exceeded', '');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it('parses retry-after hint for rate limit', () => {
    const err = classifyErrorDefault(1, 'rate limit exceeded, retry after 30 seconds', '');
    expect(err.code).toBe('rate_limit');
    expect(err.retryAfterMs).toBe(30_000);
  });

  it('returns auth error for auth patterns', () => {
    const err = classifyErrorDefault(1, 'not authenticated', '');
    expect(err.code).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeNull();
  });

  it('returns fatal for non-zero exit with no matching pattern', () => {
    const err = classifyErrorDefault(1, 'something went wrong', '');
    expect(err.code).toBe('fatal');
    expect(err.retryable).toBe(false);
  });

  it('uses first non-empty stderr line as message for fatal', () => {
    const err = classifyErrorDefault(1, '\n  actual error here\n', '');
    expect(err.message).toBe('actual error here');
  });

  it('falls back to exit code message when stderr is empty', () => {
    const err = classifyErrorDefault(42, '', '');
    expect(err.code).toBe('fatal');
    expect(err.message).toBe('Process exited with code 42');
  });

  it('returns unknown for exit code 0 with no matching pattern', () => {
    const err = classifyErrorDefault(0, '', '');
    expect(err.code).toBe('unknown');
    expect(err.retryable).toBe(false);
  });

  it('includes raw field with stderr + stdout', () => {
    const err = classifyErrorDefault(1, 'some error', 'some output');
    expect(err.raw).toBe('some error\nsome output');
  });

  it('raw field omits stdout separator when stdout is empty', () => {
    const err = classifyErrorDefault(1, 'some error', '');
    expect(err.raw).toBe('some error');
  });
});

// --- classifyError (delegation) ---

describe('classifyError', () => {
  it('delegates to claude adapter', () => {
    // Claude-specific: exit code 1 + auth keyword → auth error
    const err = classifyError('claude', 1, 'please login', '');
    expect(err.code).toBe('auth');
  });

  it('delegates to codex adapter', () => {
    // Codex-specific: non-zero exit + empty output → permission_denied
    const err = classifyError('codex', 1, '', '');
    expect(err.code).toBe('permission_denied');
  });

  it('delegates to opencode adapter', () => {
    const err = classifyError('opencode', 1, 'rate limit exceeded', '');
    expect(err.code).toBe('rate_limit');
  });

  it('multiple patterns: first match wins', () => {
    const err = classifyError('opencode', 1, 'rate limit, not authenticated', '');
    expect(err.code).toBe('rate_limit');
  });
});
