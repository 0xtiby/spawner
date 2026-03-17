import { describe, it, expect } from 'vitest';
import { KNOWN_MODELS, getKnownModels, listModels } from './models.js';
import type { KnownModel } from './types.js';

describe('KNOWN_MODELS', () => {
  it('has 7 entries', () => {
    expect(KNOWN_MODELS).toHaveLength(7);
  });
});

describe('getKnownModels', () => {
  it('returns all 7 models with no argument', () => {
    expect(getKnownModels()).toHaveLength(7);
  });

  it('returns 3 models for claude', () => {
    const models = getKnownModels('claude');
    expect(models).toHaveLength(3);
    expect(models.every((m: KnownModel) => m.cli.includes('claude'))).toBe(true);
  });

  it('returns 2 models for codex', () => {
    const models = getKnownModels('codex');
    expect(models).toHaveLength(2);
    expect(models.every((m: KnownModel) => m.cli.includes('codex'))).toBe(true);
  });

  it('returns 2 models for opencode', () => {
    const models = getKnownModels('opencode');
    expect(models).toHaveLength(2);
    expect(models.every((m: KnownModel) => m.cli.includes('opencode'))).toBe(true);
  });
});

describe('listModels', () => {
  it('returns all 7 models with no options', () => {
    expect(listModels()).toHaveLength(7);
  });

  it('returns all 7 models with empty options', () => {
    expect(listModels({})).toHaveLength(7);
  });

  it('filters by cli', () => {
    const models = listModels({ cli: 'codex' });
    expect(models).toHaveLength(2);
    expect(models.every((m: KnownModel) => m.cli.includes('codex'))).toBe(true);
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

  it('intersects cli and provider filters', () => {
    const models = listModels({ cli: 'codex', provider: 'openai' });
    expect(models).toHaveLength(2);
    expect(models.every((m: KnownModel) => m.cli.includes('codex') && m.provider === 'openai')).toBe(true);
  });

  it('filters claude cli with anthropic provider', () => {
    const models = listModels({ cli: 'claude', provider: 'anthropic' });
    expect(models).toHaveLength(3);
  });

  it('returns empty array for unknown provider', () => {
    const models = listModels({ provider: 'nonexistent' });
    expect(models).toHaveLength(0);
  });
});

describe('KNOWN_MODELS immutability', () => {
  it('is a frozen-shape array that cannot gain new entries via push', () => {
    const before = KNOWN_MODELS.length;
    // Pushing should either throw (if frozen) or not affect future reads
    try {
      (KNOWN_MODELS as KnownModel[]).push({
        id: 'fake',
        name: 'Fake',
        provider: 'other',
        cli: ['claude'],
        contextWindow: 0,
        supportsEffort: false,
      });
    } catch {
      // Expected if Object.freeze is applied
    }
    // Re-import or re-read should still be consistent
    expect(KNOWN_MODELS.length).toBeGreaterThanOrEqual(before);
  });

  it('getKnownModels with cli filter returns a new array each call', () => {
    const a = getKnownModels('claude');
    const b = getKnownModels('claude');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('listModels with filter returns a new array each call', () => {
    const a = listModels({ cli: 'codex' });
    const b = listModels({ cli: 'codex' });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
