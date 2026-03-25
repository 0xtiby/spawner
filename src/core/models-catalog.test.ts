import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchCatalog,
  ModelsFetchError,
  MODELS_DEV_URL,
} from './models-catalog.js';

const fixturePath = resolve(__dirname, '../../test/fixtures/models-dev-sample.json');
const fixtureJson = readFileSync(fixturePath, 'utf8');
const fixtureData = JSON.parse(fixtureJson);

describe('fetchCatalog', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed response on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(fixtureJson, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await fetchCatalog();
    expect(result).toEqual(fixtureData);
    expect(globalThis.fetch).toHaveBeenCalledWith(MODELS_DEV_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('throws ModelsFetchError with statusCode on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.statusCode).toBe(500);
  });

  it('throws ModelsFetchError with statusCode on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' }),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.statusCode).toBe(429);
  });

  it('throws ModelsFetchError with cause on network error', async () => {
    const networkError = new TypeError('fetch failed');
    globalThis.fetch = vi.fn().mockRejectedValue(networkError);

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.cause).toBe(networkError);
  });

  it('throws ModelsFetchError with cause on invalid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('not json {{{', { status: 200 }),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.message).toBe('Invalid JSON response');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('throws ModelsFetchError when Content-Length exceeds 10MB', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(11 * 1024 * 1024) },
      }),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.message).toContain('too large');
  });

  it('throws ModelsFetchError when response body exceeds 10MB', async () => {
    const largeBody = 'x'.repeat(10 * 1024 * 1024 + 1);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(largeBody, { status: 200 }),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.message).toContain('too large');
  });
});
