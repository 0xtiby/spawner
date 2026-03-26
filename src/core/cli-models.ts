import { execCommand } from './detect.js';
import type { ExecResult, ExecError } from './detect.js';
import type { KnownModel } from '../types.js';
import { createDebugLogger } from './debug.js';

const log = createDebugLogger();

// --- Error class ---

export class CliModelsFetchError extends Error {
  readonly kind: 'enoent' | 'timeout' | 'exit_code' | 'error';

  constructor(
    message: string,
    kind: CliModelsFetchError['kind'],
    options?: { cause?: Error },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'CliModelsFetchError';
    this.kind = kind;
  }
}

// --- Type guard ---

function isExecError(result: ExecResult | ExecError): result is ExecError {
  return 'kind' in result;
}

// --- Parsing ---

export function parseCliModelsOutput(stdout: string): KnownModel[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const slashIndex = line.indexOf('/');
      const provider = slashIndex > 0 ? line.substring(0, slashIndex) : 'unknown';
      return {
        id: line,
        name: line,
        provider,
        contextWindow: null,
        supportsEffort: false,
      };
    });
}

// --- Fetch ---

export async function fetchCliModels(): Promise<KnownModel[]> {
  log?.('fetchCliModels: executing opencode models');
  const result = await execCommand('opencode', ['models']);

  if (isExecError(result)) {
    switch (result.kind) {
      case 'enoent':
        throw new CliModelsFetchError('opencode binary not found', 'enoent');
      case 'timeout':
        throw new CliModelsFetchError('opencode models timed out', 'timeout');
      case 'error':
        throw new CliModelsFetchError('opencode models failed to spawn', 'error', {
          cause: result.error instanceof Error ? result.error : new Error(String(result.error)),
        });
    }
  }

  if (result.exitCode !== 0) {
    const detail = result.stderr ? `: ${result.stderr}` : '';
    throw new CliModelsFetchError(
      `opencode models exited with code ${result.exitCode}${detail}`,
      'exit_code',
    );
  }

  const models = parseCliModelsOutput(result.stdout);
  log?.(`fetchCliModels: parsed ${models.length} models`);
  return models;
}

// --- Cache ---

export const CLI_MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CliModelsCache {
  data: KnownModel[];
  fetchedAt: number;
}

let cache: CliModelsCache | null = null;
let inflight: Promise<CliModelsCache> | null = null;

export async function ensureCliModelsCache(): Promise<CliModelsCache> {
  if (cache && (Date.now() - cache.fetchedAt) < CLI_MODELS_CACHE_TTL_MS) {
    log?.('ensureCliModelsCache: cache hit');
    return cache;
  }

  if (inflight) {
    log?.('ensureCliModelsCache: joining inflight request');
    return inflight;
  }

  inflight = (async () => {
    try {
      const data = await fetchCliModels();
      cache = { data, fetchedAt: Date.now() };
      return cache;
    } catch (err) {
      if (cache) {
        log?.('ensureCliModelsCache: fetch failed, returning stale cache');
        return cache;
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function refreshCliModelsCache(): Promise<CliModelsCache> {
  log?.('refreshCliModelsCache: forcing refresh');
  const data = await fetchCliModels();
  cache = { data, fetchedAt: Date.now() };
  return cache;
}

export function clearCliModelsCache(): void {
  cache = null;
  inflight = null;
  log?.('clearCliModelsCache: cache cleared');
}

export function getCliModelsCache(): CliModelsCache | null {
  return cache;
}
