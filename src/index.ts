// --- Public types ---
export type {
  CliName,
  CliEvent,
  CliEventType,
  CliResult,
  CliError,
  CliErrorCode,
  CliProcess,
  SpawnOptions,
  DetectResult,
  TokenUsage,
  ExtractOptions,
  KnownModel,
  ListModelsOptions,
} from './types.js';

// --- Models registry ---
export { getKnownModels, listModels } from './models.js';

export { detect, detectAll } from './core/detect.js';
export { spawn } from './core/spawn.js';
export { extract } from './core/extract.js';
export { classifyError, classifyErrorDefault, matchSharedPatterns, parseRetryAfterMs } from './core/errors.js';
