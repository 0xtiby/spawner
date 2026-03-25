import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLI_PROVIDER_MAP, listModels, getKnownModels, refreshModels } from './models.js';
import { clearCache, ModelsFetchError, MODELS_DEV_URL } from './core/models-catalog.js';
import type { KnownModel } from './types.js';

const fixturePath = resolve(__dirname, '../test/fixtures/models-dev-sample.json');
const fixtureJson = readFileSync(fixturePath, 'utf8');

const originalFetch = globalThis.fetch;

function mockFetchSuccess() {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(fixtureJson, { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

function mockFetchFailure() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

beforeEach(() => {
  clearCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CLI_PROVIDER_MAP', () => {
  it('has entries for all three CliName values', () => {
    expect(Object.keys(CLI_PROVIDER_MAP)).toEqual(['claude', 'codex', 'opencode']);
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
    // Verify sorted
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

  it('filters by cli=opencode → all models (no filter)', async () => {
    mockFetchSuccess();
    const models = await listModels({ cli: 'opencode' });
    expect(models.length).toBe(4);
  });

  it('filters by provider=google', async () => {
    mockFetchSuccess();
    const models = await listModels({ provider: 'google' });
    expect(models.every(m => m.provider === 'other')).toBe(true);
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
});

describe('refreshModels', () => {
  it('calls invalidateAndFetch successfully', async () => {
    mockFetchSuccess();
    await expect(refreshModels()).resolves.toBeUndefined();
  });

  it('throws when invalidateAndFetch fails', async () => {
    mockFetchFailure();
    await expect(refreshModels()).rejects.toThrow(ModelsFetchError);
  });

  it('after failed refresh, listModels still returns cached data', async () => {
    // Populate cache
    mockFetchSuccess();
    const before = await listModels();
    expect(before.length).toBe(4);

    // Fail refresh
    mockFetchFailure();
    await expect(refreshModels()).rejects.toThrow();

    // Cache still works
    mockFetchFailure();
    const after = await listModels();
    expect(after.length).toBe(4);
  });
});
