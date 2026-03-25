import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  toKnownModel,
  transformCatalog,
  fetchCatalog,
  ensureCache,
  getCache,
  clearCache,
  ModelsFetchError,
  MODELS_DEV_URL,
  CACHE_TTL_MS,
  type ModelsDevRawModel,
  type ModelsDevRawResponse,
} from '../../src/core/models-catalog.js';

const fixturePath = resolve(__dirname, '../fixtures/models-dev-sample.json');
const fixtureJson = readFileSync(fixturePath, 'utf8');
const fixtureData = JSON.parse(fixtureJson);
const fixture = fixtureData as ModelsDevRawResponse;

describe('toKnownModel', () => {
  it('maps complete model with all fields', () => {
    const raw: ModelsDevRawModel = {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      reasoning: true,
      limit: { context: 200000, output: 64000 },
    };
    const result = toKnownModel('anthropic', raw);
    expect(result).toEqual({
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      provider: 'anthropic',
      cli: [],
      contextWindow: 200000,
      supportsEffort: true,
    });
  });

  it('maps missing limit to contextWindow: null', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test' };
    const result = toKnownModel('anthropic', raw);
    expect(result.contextWindow).toBeNull();
  });

  it('maps missing reasoning to supportsEffort: false', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test' };
    const result = toKnownModel('anthropic', raw);
    expect(result.supportsEffort).toBe(false);
  });

  it('maps reasoning:true to supportsEffort: true', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test', reasoning: true };
    const result = toKnownModel('openai', raw);
    expect(result.supportsEffort).toBe(true);
  });

  it('maps provider "anthropic" correctly', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test' };
    expect(toKnownModel('anthropic', raw).provider).toBe('anthropic');
  });

  it('maps provider "openai" correctly', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test' };
    expect(toKnownModel('openai', raw).provider).toBe('openai');
  });

  it('maps unknown provider "google" to "other"', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test' };
    expect(toKnownModel('google', raw).provider).toBe('other');
  });

  it('always sets cli to empty array', () => {
    const raw: ModelsDevRawModel = { id: 'test', name: 'Test', reasoning: true, limit: { context: 100 } };
    expect(toKnownModel('anthropic', raw).cli).toEqual([]);
  });
});

describe('transformCatalog', () => {
  it('transforms fixture with correct provider count', () => {
    const result = transformCatalog(fixture);
    expect(result.size).toBe(4);
  });

  it('transforms anthropic provider with 2 models', () => {
    const result = transformCatalog(fixture);
    const anthropic = result.get('anthropic')!;
    expect(anthropic).toHaveLength(2);
    expect(anthropic[0].provider).toBe('anthropic');
  });

  it('transforms openai provider with 1 model', () => {
    const result = transformCatalog(fixture);
    const openai = result.get('openai')!;
    expect(openai).toHaveLength(1);
    expect(openai[0].id).toBe('gpt-4o');
  });

  it('includes empty provider with empty array', () => {
    const result = transformCatalog(fixture);
    const empty = result.get('empty-provider')!;
    expect(empty).toEqual([]);
  });

  it('skips malformed entry without models dict', () => {
    const raw = {
      ...fixture,
      broken: { id: 'broken', name: 'Broken' } as unknown as ModelsDevRawResponse[string],
    };
    const result = transformCatalog(raw);
    expect(result.has('broken')).toBe(false);
    expect(result.size).toBe(4); // original 4 providers only
  });
});

describe('fetchCatalog', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed JSON on successful fetch', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(fixtureJson, { status: 200 })),
    );

    const result = await fetchCatalog();
    expect(result).toEqual(fixtureData);
  });

  it('calls fetch with correct URL and AbortSignal', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(fixtureJson, { status: 200 })),
    );

    await fetchCatalog();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      MODELS_DEV_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('throws ModelsFetchError with statusCode on 500', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.statusCode).toBe(500);
  });

  it('throws ModelsFetchError with statusCode on 429', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' })),
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
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('not json {{{', { status: 200 })),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.message).toBe('Invalid JSON response');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('throws ModelsFetchError when Content-Length exceeds 10MB', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('{}', {
        status: 200,
        headers: { 'content-length': String(11 * 1024 * 1024) },
      })),
    );

    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
    expect(err.message).toContain('too large');
  });
});

describe('ensureCache', () => {
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

  it('fetches and returns fresh data when cache is empty', async () => {
    mockFetchSuccess();
    const result = await ensureCache();
    expect(result.stale).toBe(false);
    expect(result.data).toBeInstanceOf(Map);
    expect(result.data.size).toBe(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached data without fetching when cache is fresh', async () => {
    mockFetchSuccess();
    await ensureCache();
    const fetchCount = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const result = await ensureCache();
    expect(result.stale).toBe(false);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCount);
  });

  it('re-fetches when cache is expired', async () => {
    mockFetchSuccess();
    await ensureCache();

    const cached = getCache()!;
    Object.assign(cached, { fetchedAt: Date.now() - CACHE_TTL_MS - 1 });

    await ensureCache();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent calls — only one fetch', async () => {
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

  it('returns stale cache with stale:true when fetch fails and cache exists', async () => {
    mockFetchSuccess();
    await ensureCache();

    const cached = getCache()!;
    Object.assign(cached, { fetchedAt: Date.now() - CACHE_TTL_MS - 1 });

    mockFetchFailure();
    const result = await ensureCache();
    expect(result.stale).toBe(true);
    expect(result.data.size).toBe(4);
  });

  it('throws ModelsFetchError when no cache and fetch fails', async () => {
    mockFetchFailure();
    const err = await ensureCache().catch((e) => e);
    expect(err).toBeInstanceOf(ModelsFetchError);
  });

  it('retries after inflight failure — inflight cleared', async () => {
    mockFetchFailure();
    await ensureCache().catch(() => {});

    mockFetchSuccess();
    const result = await ensureCache();
    expect(result.stale).toBe(false);
    expect(result.data.size).toBe(4);
  });

  it('clearCache then ensureCache triggers fresh fetch', async () => {
    mockFetchSuccess();
    await ensureCache();
    clearCache();
    expect(getCache()).toBeNull();

    await ensureCache();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
