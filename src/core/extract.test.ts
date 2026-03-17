import { describe, it, expect } from 'vitest';
import { extract } from './extract.js';

describe('extract', () => {
  describe('Claude adapter', () => {
    it('extracts sessionId, model, and usage from result line', () => {
      const rawOutput = [
        JSON.stringify({ type: 'system', session_id: 'sess-abc', model: 'opus-4' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
        JSON.stringify({ type: 'result', session_id: 'sess-abc', model: 'opus-4', usage: { input_tokens: 200, output_tokens: 80 }, cost_usd: 0.012 }),
      ].join('\n');

      const result = extract({ cli: 'claude', rawOutput });

      expect(result.sessionId).toBe('sess-abc');
      expect(result.model).toBe('opus-4');
      expect(result.usage!.inputTokens).toBe(200);
      expect(result.usage!.outputTokens).toBe(80);
      expect(result.usage!.totalTokens).toBe(280);
      expect(result.usage!.cost).toBe(0.012);
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.durationMs).toBe(0);
    });
  });

  describe('Codex adapter', () => {
    it('extracts usage from response.completed', () => {
      const rawOutput = [
        JSON.stringify({ type: 'item.completed', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] } }),
        JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 150, output_tokens: 60 } } }),
      ].join('\n');

      const result = extract({ cli: 'codex', rawOutput });

      expect(result.usage!.inputTokens).toBe(150);
      expect(result.usage!.outputTokens).toBe(60);
      expect(result.usage!.totalTokens).toBe(210);
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.durationMs).toBe(0);
    });
  });

  describe('OpenCode adapter', () => {
    it('extracts sessionId, model, usage, and cost from step_finish', () => {
      const rawOutput = [
        JSON.stringify({ type: 'text', content: 'Working on it' }),
        JSON.stringify({ type: 'step_finish', session_id: 'oc-session-1', model: 'gpt-4o', usage: { input_tokens: 300, output_tokens: 120 }, cost: 0.025 }),
      ].join('\n');

      const result = extract({ cli: 'opencode', rawOutput });

      expect(result.sessionId).toBe('oc-session-1');
      expect(result.model).toBe('gpt-4o');
      expect(result.usage!.inputTokens).toBe(300);
      expect(result.usage!.outputTokens).toBe(120);
      expect(result.usage!.totalTokens).toBe(420);
      expect(result.usage!.cost).toBe(0.025);
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.durationMs).toBe(0);
    });
  });

  describe('empty input', () => {
    it('returns CliResult with all null/zero fields', () => {
      const result = extract({ cli: 'claude', rawOutput: '' });

      expect(result.sessionId).toBeNull();
      expect(result.model).toBeNull();
      expect(result.usage!.inputTokens).toBeNull();
      expect(result.usage!.outputTokens).toBeNull();
      expect(result.usage!.totalTokens).toBeNull();
      expect(result.usage!.cost).toBeNull();
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.durationMs).toBe(0);
    });
  });

  describe('malformed input', () => {
    it('does not throw on mix of valid and invalid lines', () => {
      const rawOutput = [
        'this is not json',
        JSON.stringify({ type: 'result', session_id: 'sess-ok', model: 'opus-4', usage: { input_tokens: 50, output_tokens: 20 }, cost_usd: 0.003 }),
        '{{broken json',
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }),
      ].join('\n');

      const result = extract({ cli: 'claude', rawOutput });

      expect(result.sessionId).toBe('sess-ok');
      expect(result.model).toBe('opus-4');
      expect(result.usage!.inputTokens).toBe(50);
      expect(result.usage!.outputTokens).toBe(20);
      expect(result.usage!.cost).toBe(0.003);
    });
  });

  describe('no session or usage data', () => {
    it('returns null sessionId and null usage fields', () => {
      const rawOutput = [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      ].join('\n');

      const result = extract({ cli: 'claude', rawOutput });

      expect(result.sessionId).toBeNull();
      expect(result.usage!.inputTokens).toBeNull();
      expect(result.usage!.outputTokens).toBeNull();
      expect(result.usage!.totalTokens).toBeNull();
    });
  });

  describe('line endings', () => {
    it('handles \\r\\n line endings same as \\n', () => {
      const rawOutput = [
        JSON.stringify({ type: 'system', session_id: 'sess-crlf', model: 'opus-4' }),
        JSON.stringify({ type: 'result', session_id: 'sess-crlf', model: 'opus-4', usage: { input_tokens: 10, output_tokens: 5 }, cost_usd: 0.001 }),
      ].join('\r\n');

      const result = extract({ cli: 'claude', rawOutput });

      expect(result.sessionId).toBe('sess-crlf');
      expect(result.model).toBe('opus-4');
      expect(result.usage!.inputTokens).toBe(10);
      expect(result.usage!.outputTokens).toBe(5);
      expect(result.usage!.totalTokens).toBe(15);
      expect(result.usage!.cost).toBe(0.001);
    });
  });
});
