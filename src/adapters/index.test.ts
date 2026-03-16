import { describe, it, expect } from 'vitest';
import { getAdapter } from './index.js';
import type { CliName } from '../types.js';

describe('getAdapter', () => {
  const cliNames: CliName[] = ['claude', 'codex', 'opencode'];

  for (const name of cliNames) {
    it(`returns adapter with name '${name}'`, () => {
      const adapter = getAdapter(name);
      expect(adapter.name).toBe(name);
    });

    it(`${name} adapter has all required methods`, () => {
      const adapter = getAdapter(name);
      expect(typeof adapter.buildCommand).toBe('function');
      expect(typeof adapter.parseLine).toBe('function');
      expect(typeof adapter.detect).toBe('function');
      expect(typeof adapter.classifyError).toBe('function');
    });
  }

  const classifyErrorStubs: CliName[] = ['opencode'];
  for (const name of classifyErrorStubs) {
    it(`${name} adapter classifyError throws (not yet implemented)`, () => {
      const adapter = getAdapter(name);
      expect(() => adapter.classifyError(1, '', '')).toThrow(`${name} adapter classifyError not implemented`);
    });
  }

  it('opencode adapter parseLine returns empty array for empty line', () => {
    const adapter = getAdapter('opencode');
    expect(adapter.parseLine('', { sessionId: null, model: null, inputTokens: 0, outputTokens: 0, cost: null })).toEqual([]);
  });

  it('claude adapter buildCommand returns valid command', () => {
    const adapter = getAdapter('claude');
    const result = adapter.buildCommand({ cli: 'claude', prompt: 'hi', cwd: '/tmp' });
    expect(result.bin).toBe('claude');
    expect(result.args).toContain('--print');
    expect(result.stdinInput).toBe('hi');
  });

  it('codex adapter buildCommand returns valid command', () => {
    const adapter = getAdapter('codex');
    const result = adapter.buildCommand({ cli: 'codex', prompt: 'hi', cwd: '/tmp' });
    expect(result.bin).toBe('codex');
    expect(result.args).toContain('exec');
    expect(result.stdinInput).toBe('hi');
  });

  it('opencode adapter buildCommand returns valid command', () => {
    const adapter = getAdapter('opencode');
    const result = adapter.buildCommand({ cli: 'opencode', prompt: 'hi', cwd: '/tmp' });
    expect(result.bin).toBe('opencode');
    expect(result.args).toContain('run');
    expect(result.stdinInput).toBe('hi');
  });
});
