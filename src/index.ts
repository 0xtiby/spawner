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

export { getKnownModels, listModels, refreshModels } from './models.js';

export { detect, detectAll } from './core/detect.js';
export { spawn } from './core/spawn.js';
export { extract } from './core/extract.js';
export { classifyError, classifyErrorDefault, matchSharedPatterns, parseRetryAfterMs } from './core/errors.js';

export {
  fetchCliModels,
  ensureCliModelsCache,
  refreshCliModelsCache,
  clearCliModelsCache,
  getCliModelsCache,
  CliModelsFetchError,
  CLI_MODELS_CACHE_TTL_MS,
} from './core/cli-models.js';
export type { CliModelsCache } from './core/cli-models.js';
