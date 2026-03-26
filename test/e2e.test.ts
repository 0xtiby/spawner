/**
 * End-to-end tests — runs against real CLIs.
 *
 * Usage:
 *   pnpm e2e                    # run all tests
 *   pnpm e2e -- -t 'claude'     # single CLI
 *
 * These tests are NOT part of `pnpm test` — they must be invoked explicitly.
 * Tests for CLIs that aren't installed or authenticated are automatically skipped.
 */

import { describe, it, expect } from 'vitest';
import {
  detect,
  detectAll,
  spawn,
  listModels,
  getKnownModels,
  extract,
  classifyError,
} from '../src/index.js';
import type { CliName, CliEvent, DetectResult } from '../src/index.js';

// ---------------------------------------------------------------------------
// Shared state — resolved at module level so describe.skipIf can use it
// ---------------------------------------------------------------------------

const CLI_NAMES: CliName[] = ['claude', 'codex', 'opencode'];
const installed = await detectAll();

async function collectEvents(iter: AsyncIterable<CliEvent>): Promise<CliEvent[]> {
  const events: CliEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

// ---------------------------------------------------------------------------
// detect / detectAll
// ---------------------------------------------------------------------------

describe('detect / detectAll', () => {
  it('detectAll returns a result for every CLI', () => {
    for (const cli of CLI_NAMES) {
      const r = installed[cli];
      expect(r).toBeDefined();
      expect(typeof r.installed).toBe('boolean');
    }
  });

  for (const cli of CLI_NAMES) {
    it(`detect("${cli}") matches detectAll`, async () => {
      const single = await detect(cli);
      expect(single.installed).toBe(installed[cli].installed);
      if (single.installed) {
        expect(single.version).toBeTruthy();
        expect(single.binaryPath).toBeTruthy();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// listModels / getKnownModels (real models.dev)
// ---------------------------------------------------------------------------

describe('listModels', () => {
  it('returns a non-empty array of models', async () => {
    const models = await listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('id');
    expect(models[0]).toHaveProperty('provider');
  }, 15_000);

  for (const cli of CLI_NAMES) {
    it(`getKnownModels("${cli}") returns models`, async () => {
      const models = await getKnownModels(cli);
      expect(models.length).toBeGreaterThan(0);
    }, 15_000);
  }
});

// ---------------------------------------------------------------------------
// extract (static JSONL parsing)
// ---------------------------------------------------------------------------

describe('extract', () => {
  it('parses a minimal claude JSONL blob into CliResult', () => {
    const raw = [
      '{"type":"system","subtype":"init","session_id":"s1","model":"claude-sonnet-4-20250514"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]},"session_id":"s1"}',
      '{"type":"result","session_id":"s1","model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":2},"cost_usd":0.0001}',
    ].join('\n');

    const result = extract({ cli: 'claude', rawOutput: raw });
    expect(result.sessionId).toBe('s1');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('recognizes rate-limit pattern', () => {
    const err = classifyError('claude', 1, 'Rate limit exceeded. Retry after 30s', '');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it('recognizes auth pattern', () => {
    const err = classifyError('claude', 1, 'Not authenticated. Please login.', '');
    expect(err.code).toBe('auth');
  });
});

// ---------------------------------------------------------------------------
// spawn — per CLI (skipped if not authenticated)
// ---------------------------------------------------------------------------

const PING_PROMPT = 'Reply with exactly one word: PONG. No punctuation, no explanation.';

for (const cli of CLI_NAMES) {
  describe.skipIf(!installed[cli]?.authenticated)(`spawn — ${cli}`, () => {
    it('spawn + collect events + done', async () => {
      const proc = spawn({
        cli,
        prompt: PING_PROMPT,
        cwd: process.cwd(),
        effort: 'low',
      });

      expect(proc.pid).toBeGreaterThan(0);

      const events = await collectEvents(proc.events);
      const result = await proc.done;

      const textEvents = events.filter(e => e.type === 'text');
      const doneEvents = events.filter(e => e.type === 'done');
      expect(textEvents.length).toBeGreaterThanOrEqual(1);
      expect(doneEvents).toHaveLength(1);

      const fullText = textEvents.map(e => e.content ?? '').join('');
      expect(fullText.toLowerCase()).toContain('pong');

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.sessionId).toBeTruthy();
    }, 60_000);

    it('abort signal stops the process', async () => {
      const ac = new AbortController();

      const proc = spawn({
        cli,
        prompt: 'Write a very long essay about the history of computing.',
        cwd: process.cwd(),
        abortSignal: ac.signal,
      });

      const firstEvent = await (async () => {
        for await (const e of proc.events) {
          ac.abort();
          return e;
        }
      })();

      expect(firstEvent).toBeDefined();

      const result = await proc.done;
      expect(result).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    }, 60_000);

    it('session continuity', async () => {
      const first = spawn({
        cli,
        prompt: 'Remember this word: FLAMINGO. Just confirm you remember it.',
        cwd: process.cwd(),
        effort: 'low',
      });
      const firstResult = await first.done;
      expect(firstResult.exitCode).toBe(0);
      expect(firstResult.sessionId).toBeTruthy();

      const second = spawn({
        cli,
        prompt: 'What word did I ask you to remember? Reply with just the word.',
        cwd: process.cwd(),
        sessionId: firstResult.sessionId!,
        continueSession: true,
        effort: 'low',
      });

      const events = await collectEvents(second.events);
      const secondResult = await second.done;

      const fullText = events
        .filter(e => e.type === 'text')
        .map(e => e.content ?? '')
        .join('');

      expect(fullText.toLowerCase()).toContain('flamingo');
      expect(secondResult.exitCode).toBe(0);
    }, 120_000);

    it('invalid model — process completes without hanging', async () => {
      const proc = spawn({
        cli,
        prompt: 'hello',
        cwd: process.cwd(),
        model: 'nonexistent-model-xyz-999',
      });

      const result = await proc.done;
      // Some CLIs error out, others silently fall back — just verify it doesn't hang
      expect(result).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    }, 60_000);

    it('empty prompt still completes', async () => {
      const proc = spawn({
        cli,
        prompt: '',
        cwd: process.cwd(),
        effort: 'low',
      });

      const result = await proc.done;
      expect(result).toBeDefined();
    }, 60_000);
  });
}
