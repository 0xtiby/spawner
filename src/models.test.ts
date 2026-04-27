import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLI_PROVIDER_MAP, listModels, getKnownModels, refreshModels } from './models.js';
import { clearCache, CACHE_TTL_MS, ModelsFetchError } from './core/models-catalog.js';
import { clearCliModelsCache, CliModelsFetchError } from './core/cli-models.js';
import type { KnownModel } from './types.js';

const fixtureJson = readFileSync(resolve(__dirname, '../test/fixtures/models-dev-sample.json'), 'utf8');
const originalFetch = globalThis.fetch;

const mockEnsureCliModelsCache = vi.fn();
const mockRefreshCliModelsCache = vi.fn();

vi.mock('./core/cli-models.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core/cli-models.js')>();
  return {
    ...actual,
    ensureCliModelsCache: (...args: unknown[]) => mockEnsureCliModelsCache(...args),
    refreshCliModelsCache: (...args: unknown[]) => mockRefreshCliModelsCache(...args),
  };
});

function mockFetchSuccess() {
  globalThis.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(fixtureJson, { status: 200 })),
  );
}

function mockFetchFailure() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

const defaultCliModels: KnownModel[] = [
  { id: 'anthropic/claude-sonnet-4-20250514', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', contextWindow: null, supportsEffort: false },
  { id: 'openai/gpt-4o', name: 'openai/gpt-4o', provider: 'openai', contextWindow: null, supportsEffort: false },
  { id: 'anthropic/claude-haiku-3.5', name: 'anthropic/claude-haiku-3.5', provider: 'anthropic', contextWindow: null, supportsEffort: false },
];

beforeEach(() => {
  clearCache();
  clearCliModelsCache();
  mockEnsureCliModelsCache.mockReset();
  mockRefreshCliModelsCache.mockReset();
  mockEnsureCliModelsCache.mockResolvedValue({ data: defaultCliModels, fetchedAt: Date.now() });
  mockRefreshCliModelsCache.mockResolvedValue({ data: defaultCliModels, fetchedAt: Date.now() });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CLI_PROVIDER_MAP', () => {
  it('has entries for all CliName values', () => {
    expect(Object.keys(CLI_PROVIDER_MAP)).toEqual(['claude', 'codex', 'opencode', 'pi']);
  });

  it('maps claude to anthropic', () => {
    expect(CLI_PROVIDER_MAP.claude).toBe('anthropic');
  });

  it('maps codex to openai', () => {
    expect(CLI_PROVIDER_MAP.codex).toBe('openai');
  });

  it('maps opencode to null', () => {
    expect(CLI_PROVIDER_MAP.opencode).toBeNull();
  });
});

describe('listModels', () => {
  it('returns all models sorted by id with no options', async () => {
    mockFetchSuccess();
    const models = await listModels();
    expect(models.length).toBe(4); // 2 anthropic + 1 openai + 1 google
    for (let i = 1; i < models.length; i++) {
      expect(models[i - 1].id.localeCompare(models[i].id, 'en')).toBeLessThanOrEqual(0);
    }
  });

  it('filters by cli=claude → anthropic models only', async () => {
    mockFetchSuccess();
    const models = await listModels({ cli: 'claude' });
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    expect(models.length).toBe(2);
  });

  it('filters by cli=codex → openai models only', async () => {
    mockFetchSuccess();
    const models = await listModels({ cli: 'codex' });
    expect(models.every(m => m.provider === 'openai')).toBe(true);
    expect(models.length).toBe(1);
  });

  it('routes cli=opencode to CLI discovery (not models.dev)', async () => {
    const models = await listModels({ cli: 'opencode' });
    expect(models.length).toBe(3); // from defaultCliModels
    expect(models.every(m => m.id.includes('/'))).toBe(true);
  });

  it('filters cli=opencode by provider', async () => {
    const models = await listModels({ cli: 'opencode', provider: 'anthropic' });
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    expect(models.length).toBe(2);
  });

  it('returns empty array for cli=opencode with nonexistent provider', async () => {
    const models = await listModels({ cli: 'opencode', provider: 'nonexistent' });
    expect(models).toHaveLength(0);
  });

  it('ignores fallback for cli=opencode and propagates error', async () => {
    mockEnsureCliModelsCache.mockRejectedValue(new CliModelsFetchError('opencode not found', 'enoent'));
    const fallback: KnownModel[] = [
      { id: 'fb', name: 'FB', provider: 'anthropic', contextWindow: null, supportsEffort: false },
    ];
    await expect(listModels({ cli: 'opencode', fallback })).rejects.toThrow(CliModelsFetchError);
  });

  it('sorts cli=opencode results alphabetically by id', async () => {
    const models = await listModels({ cli: 'opencode' });
    const ids = models.map(m => m.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b, 'en'));
    expect(ids).toEqual(sorted);
  });

  it('provider=anthropic without cli uses models.dev (no CLI involvement)', async () => {
    mockFetchSuccess();
    const models = await listModels({ provider: 'anthropic' });
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    expect(models.length).toBe(2);
    expect(mockEnsureCliModelsCache).not.toHaveBeenCalled();
  });

  it('filters by provider=google', async () => {
    mockFetchSuccess();
    const models = await listModels({ provider: 'google' });
    expect(models.every(m => m.provider === 'google')).toBe(true);
    expect(models.length).toBe(1);
  });

  it('provider takes precedence over cli', async () => {
    mockFetchSuccess();
    const models = await listModels({ cli: 'claude', provider: 'openai' });
    expect(models.every(m => m.provider === 'openai')).toBe(true);
  });

  it('returns empty array for unknown provider', async () => {
    mockFetchSuccess();
    const models = await listModels({ provider: 'nonexistent' });
    expect(models).toHaveLength(0);
  });

  it('returns fallback when ensureCache throws', async () => {
    mockFetchFailure();
    const fallback: KnownModel[] = [
      { id: 'fallback-model', name: 'Fallback', provider: 'anthropic', contextWindow: 100_000, supportsEffort: false },
    ];
    const models = await listModels({ fallback });
    expect(models).toBe(fallback);
  });

  it('throws ModelsFetchError when ensureCache throws and no fallback', async () => {
    mockFetchFailure();
    await expect(listModels()).rejects.toThrow(ModelsFetchError);
  });

  it('results are sorted alphabetically by id', async () => {
    mockFetchSuccess();
    const models = await listModels();
    const ids = models.map(m => m.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b, 'en'));
    expect(ids).toEqual(sorted);
  });

  it('uses cache on second call (no additional fetch)', async () => {
    mockFetchSuccess();
    await listModels();
    await listModels();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache data instead of fallback on expired cache + fetch failure', async () => {
    mockFetchSuccess();
    const initial = await listModels();
    expect(initial.length).toBe(4);

    vi.useFakeTimers();
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    mockFetchFailure();
    const fallback: KnownModel[] = [
      { id: 'fb', name: 'FB', provider: 'anthropic', contextWindow: null, supportsEffort: false },
    ];
    const models = await listModels({ fallback });
    expect(models.length).toBe(4); // stale cache, not fallback
    vi.useRealTimers();
  });
});

describe('getKnownModels', () => {
  it('returns all models when called with no args', async () => {
    mockFetchSuccess();
    const models = await getKnownModels();
    expect(models.length).toBe(4);
  });

  it('filters by cli name', async () => {
    mockFetchSuccess();
    const models = await getKnownModels('claude');
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
  });

  it('returns fallback on failure', async () => {
    mockFetchFailure();
    const fallback: KnownModel[] = [
      { id: 'fb', name: 'FB', provider: 'anthropic', contextWindow: null, supportsEffort: false },
    ];
    const models = await getKnownModels('claude', fallback);
    expect(models).toBe(fallback);
  });

  it('delegates opencode to CLI path', async () => {
    const models = await getKnownModels('opencode');
    expect(models.length).toBe(3);
    expect(mockEnsureCliModelsCache).toHaveBeenCalled();
  });
});

describe('refreshModels', () => {
  it('resolves when both caches refresh successfully', async () => {
    mockFetchSuccess();
    await expect(refreshModels()).resolves.toBeUndefined();
  });

  it('resolves when only models.dev refresh fails (CLI succeeds)', async () => {
    mockFetchFailure();
    await expect(refreshModels()).resolves.toBeUndefined();
  });

  it('resolves when only CLI refresh fails (models.dev succeeds)', async () => {
    mockFetchSuccess();
    mockRefreshCliModelsCache.mockRejectedValue(new Error('CLI failed'));
    await expect(refreshModels()).resolves.toBeUndefined();
  });

  it('throws when both refreshes fail', async () => {
    mockFetchFailure();
    mockRefreshCliModelsCache.mockRejectedValue(new Error('CLI failed'));
    await expect(refreshModels()).rejects.toThrow();
  });

  it('after failed models.dev refresh, listModels still returns cached data', async () => {
    mockFetchSuccess();
    const before = await listModels();
    expect(before.length).toBe(4);

    mockFetchFailure();
    // refreshModels resolves because CLI refresh succeeds
    await expect(refreshModels()).resolves.toBeUndefined();

    mockFetchFailure();
    const after = await listModels();
    expect(after.length).toBe(4);
  });
});
