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

  const stubNames: CliName[] = ['codex', 'opencode'];
  for (const name of stubNames) {
    it(`${name} adapter unimplemented methods throw`, () => {
      const adapter = getAdapter(name);
      expect(() => adapter.parseLine('', {} as any)).toThrow(`${name} adapter parseLine not implemented`);
      expect(() => adapter.classifyError(1, '', '')).toThrow(`${name} adapter classifyError not implemented`);
    });
  }

  it('opencode adapter buildCommand returns valid command', () => {
    const adapter = getAdapter('opencode');
    const result = adapter.buildCommand({ cli: 'opencode', prompt: 'test', cwd: '/tmp' });
    expect(result.bin).toBe('opencode');
    expect(result.args).toContain('run');
  });
});
