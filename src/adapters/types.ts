import type { CliName, SpawnOptions, CliEvent, DetectResult, CliError } from '../types.js';

export interface CliAdapter {
  name: CliName;
  buildCommand(options: SpawnOptions): { bin: string; args: string[]; stdinInput?: string };
  parseLine(line: string, accumulator: SessionAccumulator): CliEvent[];
  detect(): Promise<DetectResult>;
  classifyError(exitCode: number, stderr: string, stdout: string): CliError;
}

export interface SessionAccumulator {
  sessionId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export function createAccumulator(): SessionAccumulator {
  return { sessionId: null, model: null, inputTokens: 0, outputTokens: 0, cost: null };
}
