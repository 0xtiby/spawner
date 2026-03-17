import type { CliResult, ExtractOptions } from '../types.js';
import { getAdapter } from '../adapters/index.js';
import { createAccumulator } from '../adapters/types.js';

export function extract(options: ExtractOptions): CliResult {
  const { cli, rawOutput } = options;
  const adapter = getAdapter(cli);
  const accumulator = createAccumulator();

  if (rawOutput) {
    const lines = rawOutput.split(/\r?\n/);
    for (const line of lines) {
      if (line) {
        adapter.parseLine(line, accumulator);
      }
    }
  }

  return {
    exitCode: 0,
    sessionId: accumulator.sessionId,
    usage: {
      inputTokens: accumulator.inputTokens || null,
      outputTokens: accumulator.outputTokens || null,
      totalTokens:
        accumulator.inputTokens || accumulator.outputTokens
          ? (accumulator.inputTokens || 0) + (accumulator.outputTokens || 0)
          : null,
      cost: accumulator.cost,
    },
    model: accumulator.model,
    error: null,
    durationMs: 0,
  };
}
