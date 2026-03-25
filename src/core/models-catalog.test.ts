import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchCatalog,
  ensureCache,
  getCache,
  clearCache,
  invalidateAndFetch,
  ModelsFetchError,
  MODELS_DEV_URL,
  CACHE_TTL_MS,
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

describe('cache management', () => {
  const originalFetch = globalThis.fetch;

  function mockFetchSuccess() {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(fixtureJson, { status: 200 })),
    );
  }

  function mockFetchFailure() {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
  }

  beforeEach(() => {
    clearCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearCache();
  });

  it('ensureCache with empty cache fetches and returns fresh data', async () => {
    mockFetchSuccess();
    const result = await ensureCache();
    expect(result.stale).toBe(false);
    expect(result.data).toBeInstanceOf(Map);
    expect(result.data.size).toBe(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('ensureCache with fresh cache returns cached data without fetching', async () => {
    mockFetchSuccess();
    await ensureCache();
    const fetchCount = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const result = await ensureCache();
    expect(result.stale).toBe(false);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCount);
  });

  it('ensureCache with expired cache re-fetches', async () => {
    mockFetchSuccess();
    await ensureCache();

    // Expire the cache by manipulating fetchedAt
    const cached = getCache()!;
    Object.assign(cached, { fetchedAt: Date.now() - CACHE_TTL_MS - 1 });

    await ensureCache();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('ensureCache deduplicates concurrent calls', async () => {
    let resolvePromise: (v: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => { resolvePromise = resolve; }),
    );

    const p1 = ensureCache();
    const p2 = ensureCache();

    resolvePromise!(new Response(fixtureJson, { status: 200 }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('ensureCache returns stale cache on fetch failure when cache exists', async () => {
    mockFetchSuccess();
    await ensureCache();

    // Expire the cache
    const cached = getCache()!;
    Object.assign(cached, { fetchedAt: Date.now() - CACHE_TTL_MS - 1 });

    mockFetchFailure();
    const result = await ensureCache();
    expect(result.stale).toBe(true);
    expect(result.data.size).toBe(4);
  });

  it('ensureCache throws ModelsFetchError when no cache and fetch fails', async () => {
    mockFetchFailure();
    const err = await ensureCache().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
  });

  it('ensureCache retries after inflight failure', async () => {
    mockFetchFailure();
    await ensureCache().catch(() => {});

    mockFetchSuccess();
    const result = await ensureCache();
    expect(result.stale).toBe(false);
    expect(result.data.size).toBe(4);
  });

  it('getCache returns null when no cache', () => {
    expect(getCache()).toBeNull();
  });

  it('clearCache then ensureCache triggers fresh fetch', async () => {
    mockFetchSuccess();
    await ensureCache();
    clearCache();
    expect(getCache()).toBeNull();

    await ensureCache();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidateAndFetch replaces cache on success', async () => {
    mockFetchSuccess();
    await ensureCache();
    const oldCache = getCache();

    mockFetchSuccess();
    const result = await invalidateAndFetch();
    expect(result).not.toBe(oldCache);
    expect(result.stale).toBe(false);
  });

  it('invalidateAndFetch preserves cache on failure and throws', async () => {
    mockFetchSuccess();
    await ensureCache();
    const cachedBefore = getCache();

    mockFetchFailure();
    const err = await invalidateAndFetch().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(getCache()).toBe(cachedBefore);
  });
});
