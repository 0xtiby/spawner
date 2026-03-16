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
export { KNOWN_MODELS, getKnownModels, listModels } from './models.js';

// TODO: export { detect, detectAll } from './core/detect.js';
// TODO: export { spawn } from './core/spawn.js';
// TODO: export { extract } from './core/extract.js';
// TODO: export { classifyError } from './core/errors.js';
