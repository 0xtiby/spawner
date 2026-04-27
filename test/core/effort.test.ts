import { describe, it, expect } from 'vitest';
import { mapEffortToCliFlag } from '../../src/core/effort.js';
import type { CliName, EffortLevel } from '../../src/types.js';

const ALL_EFFORTS: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'max', 'xhigh'];

describe('mapEffortToCliFlag', () => {
  describe('claude', () => {
    it('returns null for off and minimal', () => {
      expect(mapEffortToCliFlag('claude', 'off')).toBeNull();
      expect(mapEffortToCliFlag('claude', 'minimal')).toBeNull();
    });

    it('passes through low/medium/high as --effort', () => {
      expect(mapEffortToCliFlag('claude', 'low')).toEqual({ flag: '--effort', value: 'low' });
      expect(mapEffortToCliFlag('claude', 'medium')).toEqual({ flag: '--effort', value: 'medium' });
      expect(mapEffortToCliFlag('claude', 'high')).toEqual({ flag: '--effort', value: 'high' });
    });

    it('maps max and xhigh to --effort max', () => {
      expect(mapEffortToCliFlag('claude', 'max')).toEqual({ flag: '--effort', value: 'max' });
      expect(mapEffortToCliFlag('claude', 'xhigh')).toEqual({ flag: '--effort', value: 'max' });
    });
  });

  describe('codex', () => {
    it('returns null for off and minimal', () => {
      expect(mapEffortToCliFlag('codex', 'off')).toBeNull();
      expect(mapEffortToCliFlag('codex', 'minimal')).toBeNull();
    });

    it('passes through low/medium/high as -c model_reasoning_effort=...', () => {
      expect(mapEffortToCliFlag('codex', 'low')).toEqual({ flag: '-c', value: 'model_reasoning_effort=low' });
      expect(mapEffortToCliFlag('codex', 'medium')).toEqual({ flag: '-c', value: 'model_reasoning_effort=medium' });
      expect(mapEffortToCliFlag('codex', 'high')).toEqual({ flag: '-c', value: 'model_reasoning_effort=high' });
    });

    it('maps max and xhigh to model_reasoning_effort=high', () => {
      expect(mapEffortToCliFlag('codex', 'max')).toEqual({ flag: '-c', value: 'model_reasoning_effort=high' });
      expect(mapEffortToCliFlag('codex', 'xhigh')).toEqual({ flag: '-c', value: 'model_reasoning_effort=high' });
    });
  });

  describe('pi', () => {
    it('passes through off/minimal/low/medium/high as --thinking', () => {
      expect(mapEffortToCliFlag('pi', 'off')).toEqual({ flag: '--thinking', value: 'off' });
      expect(mapEffortToCliFlag('pi', 'minimal')).toEqual({ flag: '--thinking', value: 'minimal' });
      expect(mapEffortToCliFlag('pi', 'low')).toEqual({ flag: '--thinking', value: 'low' });
      expect(mapEffortToCliFlag('pi', 'medium')).toEqual({ flag: '--thinking', value: 'medium' });
      expect(mapEffortToCliFlag('pi', 'high')).toEqual({ flag: '--thinking', value: 'high' });
    });

    it('maps max and xhigh to --thinking xhigh', () => {
      expect(mapEffortToCliFlag('pi', 'max')).toEqual({ flag: '--thinking', value: 'xhigh' });
      expect(mapEffortToCliFlag('pi', 'xhigh')).toEqual({ flag: '--thinking', value: 'xhigh' });
    });
  });

  describe('opencode', () => {
    it('returns null for every effort level', () => {
      for (const effort of ALL_EFFORTS) {
        expect(mapEffortToCliFlag('opencode', effort)).toBeNull();
      }
    });
  });

  it('covers all 28 (cli, effort) combinations', () => {
    const clis: CliName[] = ['claude', 'codex', 'opencode', 'pi'];
    let count = 0;
    for (const cli of clis) {
      for (const effort of ALL_EFFORTS) {
        // exercise to ensure no throw
        mapEffortToCliFlag(cli, effort);
        count++;
      }
    }
    expect(count).toBe(28);
  });
});
