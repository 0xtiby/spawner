import { describe, it, expect } from 'vitest';
import { classifyErrorDefault, parseRetryAfterMs, matchSharedPatterns } from '../../src/core/errors.js';

describe('parseRetryAfterMs', () => {
  it('extracts seconds from "retry after 30 seconds"', () => {
    expect(parseRetryAfterMs('retry after 30 seconds')).toBe(30_000);
  });

  it('extracts seconds from "try again in 10s"', () => {
    expect(parseRetryAfterMs('try again in 10s')).toBe(10_000);
  });

  it('extracts seconds from "wait 5 sec"', () => {
    expect(parseRetryAfterMs('wait 5 sec')).toBe(5_000);
  });

  it('defaults to 60000 when no hint found', () => {
    expect(parseRetryAfterMs('rate limit exceeded')).toBe(60_000);
  });
});

describe('matchSharedPatterns', () => {
  it('matches rate_limit patterns', () => {
    const result = matchSharedPatterns('rate limit exceeded', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('rate_limit');
    expect(result!.retryable).toBe(true);
  });

  it('matches auth patterns', () => {
    const result = matchSharedPatterns('not authenticated, please login', '');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('auth');
    expect(result!.retryable).toBe(false);
  });

  it('returns null when no pattern matches', () => {
    expect(matchSharedPatterns('everything is fine', '')).toBeNull();
  });

  it('first match in priority order wins', () => {
    // "try again" matches rate_limit (higher priority) even though "auth" also present
    const result = matchSharedPatterns('try again later, auth required', '');
    expect(result!.code).toBe('rate_limit');
  });
});

describe('classifyErrorDefault', () => {
  it('rate_limit stderr → retryable with default retryAfterMs', () => {
    const err = classifyErrorDefault(1, 'rate limit exceeded', '');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it('rate_limit with "retry after 30 seconds" → retryAfterMs: 30000', () => {
    const err = classifyErrorDefault(1, 'rate limit exceeded, retry after 30 seconds', '');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it('auth stderr → not retryable', () => {
    const err = classifyErrorDefault(1, 'not authenticated', '');
    expect(err.code).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeNull();
  });

  it('session_not_found stderr', () => {
    const err = classifyErrorDefault(1, 'session not found', '');
    expect(err.code).toBe('session_not_found');
    expect(err.retryable).toBe(false);
  });

  it('model_not_found stderr', () => {
    const err = classifyErrorDefault(1, 'model not found: gpt-99', '');
    expect(err.code).toBe('model_not_found');
    expect(err.retryable).toBe(false);
  });

  it('context_overflow stderr', () => {
    const err = classifyErrorDefault(1, 'context length exceeded', '');
    expect(err.code).toBe('context_overflow');
    expect(err.retryable).toBe(false);
  });

  it('permission_denied stderr', () => {
    const err = classifyErrorDefault(1, 'permission denied', '');
    expect(err.code).toBe('permission_denied');
    expect(err.retryable).toBe(false);
  });

  it('no match + non-zero exit → fatal', () => {
    const err = classifyErrorDefault(1, 'something went wrong', '');
    expect(err.code).toBe('fatal');
    expect(err.retryable).toBe(false);
  });

  it('no match + zero exit → unknown', () => {
    const err = classifyErrorDefault(0, '', '');
    expect(err.code).toBe('unknown');
    expect(err.retryable).toBe(false);
  });

  it('multiple patterns match → first in priority order wins', () => {
    // Both rate_limit ("429") and auth ("unauthorized") present
    const err = classifyErrorDefault(1, 'Error 429: unauthorized', '');
    expect(err.code).toBe('rate_limit');
  });

  it('raw field contains full stderr+stdout', () => {
    const err = classifyErrorDefault(1, 'rate limit', 'some stdout');
    expect(err.raw).toBe('rate limit\nsome stdout');
  });

  it('message is concise (matched line, not full output)', () => {
    const err = classifyErrorDefault(1, 'line1\nrate limit exceeded\nline3', '');
    expect(err.message).toBe('rate limit exceeded');
  });

  it('matches patterns in stdout when stderr is empty', () => {
    const err = classifyErrorDefault(1, '', 'rate limit exceeded');
    expect(err.code).toBe('rate_limit');
  });

  it('case-insensitive matching', () => {
    const err = classifyErrorDefault(1, 'Rate Limit Exceeded', '');
    expect(err.code).toBe('rate_limit');
  });

  it('empty stderr and stdout with non-zero exit → fatal', () => {
    const err = classifyErrorDefault(1, '', '');
    expect(err.code).toBe('fatal');
    expect(err.message).toBe('Process exited with code 1');
  });

  it('empty stderr and stdout with zero exit → unknown', () => {
    const err = classifyErrorDefault(0, '', '');
    expect(err.code).toBe('unknown');
  });

  it('fatal message uses first non-empty stderr line', () => {
    const err = classifyErrorDefault(1, '\n  some error happened  \ndetails', '');
    expect(err.code).toBe('fatal');
    expect(err.message).toBe('some error happened');
  });
});
