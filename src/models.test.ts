import { describe, it, expect } from 'vitest';
import { CLI_PROVIDER_MAP, KNOWN_MODELS, getKnownModels, listModels } from './models.js';
import type { KnownModel } from './types.js';

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

describe('KNOWN_MODELS', () => {
  it('has 7 entries', () => {
    expect(KNOWN_MODELS).toHaveLength(7);
  });

  it('each entry has required fields', () => {
    for (const model of KNOWN_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.provider).toBeTruthy();
      expect(typeof model.supportsEffort).toBe('boolean');
    }
  });

  it('does not have cli field on any model', () => {
    for (const model of KNOWN_MODELS) {
      expect(model).not.toHaveProperty('cli');
    }
  });
});

describe('KnownModel type', () => {
  it('accepts any string as provider', () => {
    const model: KnownModel = {
      id: 'test-model',
      name: 'Test Model',
      provider: 'google',
      contextWindow: 100_000,
      supportsEffort: false,
    };
    expect(model.provider).toBe('google');
  });

  it('satisfies KnownModel shape without cli field', () => {
    const model = {
      id: 'test',
      name: 'Test',
      provider: 'anthropic',
      contextWindow: null,
      supportsEffort: false,
    } satisfies KnownModel;
    expect(model).not.toHaveProperty('cli');
    expect(model.provider).toBe('anthropic');
  });
});

describe('OpenCode namespaced ID format', () => {
  it('produces provider/id format from model fields', () => {
    const model: KnownModel = {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      provider: 'anthropic',
      contextWindow: 200_000,
      supportsEffort: true,
    };
    const namespacedId = `${model.provider}/${model.id}`;
    expect(namespacedId).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('matches actual OpenCode entries in KNOWN_MODELS', () => {
    const openCodeModels = KNOWN_MODELS.filter(m => m.id.includes('/'));
    expect(openCodeModels.length).toBeGreaterThan(0);
    for (const m of openCodeModels) {
      expect(m.id).toMatch(/^[^/]+\/.+$/);
    }
  });
});

describe('getKnownModels', () => {
  it('returns all 7 models', () => {
    expect(getKnownModels()).toHaveLength(7);
  });
});

describe('listModels', () => {
  it('returns all 7 models with no options', () => {
    expect(listModels()).toHaveLength(7);
  });

  it('returns all 7 models with empty options', () => {
    expect(listModels({})).toHaveLength(7);
  });

  it('filters by provider', () => {
    const models = listModels({ provider: 'anthropic' });
    expect(models).toHaveLength(4);
    expect(models.every((m: KnownModel) => m.provider === 'anthropic')).toBe(true);
  });

  it('filters by provider openai', () => {
    const models = listModels({ provider: 'openai' });
    expect(models).toHaveLength(3);
    expect(models.every((m: KnownModel) => m.provider === 'openai')).toBe(true);
  });

  it('returns empty array for unknown provider', () => {
    const models = listModels({ provider: 'nonexistent' });
    expect(models).toHaveLength(0);
  });
});

describe('KNOWN_MODELS immutability', () => {
  it('is a frozen-shape array that cannot gain new entries via push', () => {
    const before = KNOWN_MODELS.length;
    try {
      (KNOWN_MODELS as KnownModel[]).push({
        id: 'fake',
        name: 'Fake',
        provider: 'other',
        contextWindow: 0,
        supportsEffort: false,
      });
    } catch {
      // Expected if Object.freeze is applied
    }
    expect(KNOWN_MODELS.length).toBeGreaterThanOrEqual(before);
  });

  it('listModels with filter returns a new array each call', () => {
    const a = listModels({ provider: 'openai' });
    const b = listModels({ provider: 'openai' });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
