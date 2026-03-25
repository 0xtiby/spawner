import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  toKnownModel,
  transformCatalog,
  type ModelsDevRawModel,
  type ModelsDevRawResponse,
} from '../../src/core/models-catalog.js';

const fixturePath = resolve(__dirname, '../fixtures/models-dev-sample.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ModelsDevRawResponse;

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
