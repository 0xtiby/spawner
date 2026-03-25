import type { CliName, KnownModel, ListModelsOptions } from './types.js';
import { ensureCache, ModelsFetchError } from './core/models-catalog.js';
import { createDebugLogger } from './core/debug.js';

// --- Debug logger ---

const log = createDebugLogger();

// --- Provider mapping ---

export const CLI_PROVIDER_MAP: Record<CliName, string | null> = {
  claude: 'anthropic',
  codex: 'openai',
  opencode: null,
};

// --- Public API ---

export async function listModels(options?: ListModelsOptions): Promise<KnownModel[]> {
  let cache;
  try {
    cache = await ensureCache();
  } catch (err) {
    if (options?.fallback) {
      log?.('listModels: ensureCache failed, returning fallback');
      return options.fallback;
    }
    throw err;
  }

  // Determine provider filter
  let providerFilter: string | null = null;
  if (options?.provider) {
    providerFilter = options.provider;
    log?.(`listModels: filtering by provider=${providerFilter}`);
  } else if (options?.cli) {
    providerFilter = CLI_PROVIDER_MAP[options.cli];
    log?.(`listModels: filtering by cli=${options.cli} → provider=${providerFilter}`);
  }

  // Collect models from cache
  let models: KnownModel[] = [];
  if (providerFilter) {
    const providerModels = cache.data.get(providerFilter);
    if (providerModels) {
      models = [...providerModels];
    }
  } else {
    for (const providerModels of cache.data.values()) {
      models.push(...providerModels);
    }
  }

  // Sort alphabetically by id
  models.sort((a, b) => a.id.localeCompare(b.id, 'en'));

  log?.(`listModels: returning ${models.length} models (cache ${cache.stale ? 'stale' : 'fresh'})`);
  return models;
}

export async function getKnownModels(cli?: CliName, fallbackModels?: KnownModel[]): Promise<KnownModel[]> {
  return listModels({ cli, fallback: fallbackModels });
}
