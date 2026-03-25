import type { CliName, KnownModel, ListModelsOptions } from './types.js';
import { ensureCache, refreshCache } from './core/models-catalog.js';
import { createDebugLogger } from './core/debug.js';

const log = createDebugLogger();

export const CLI_PROVIDER_MAP: Record<CliName, string | null> = {
  claude: 'anthropic',
  codex: 'openai',
  opencode: null,
};

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

  let providerFilter: string | null = null;
  if (options?.provider) {
    providerFilter = options.provider;
    log?.(`listModels: filtering by provider=${providerFilter}`);
  } else if (options?.cli) {
    providerFilter = CLI_PROVIDER_MAP[options.cli];
    log?.(`listModels: filtering by cli=${options.cli} → provider=${providerFilter}`);
  }

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

  models.sort((a, b) => a.id.localeCompare(b.id, 'en'));

  log?.(`listModels: returning ${models.length} models (cache ${cache.stale ? 'stale' : 'fresh'})`);
  return models;
}

export async function getKnownModels(cli?: CliName, fallbackModels?: KnownModel[]): Promise<KnownModel[]> {
  return listModels({ cli, fallback: fallbackModels });
}

export async function refreshModels(): Promise<void> {
  log?.('refreshModels: refreshing cache');
  await refreshCache();
  log?.('refreshModels: cache refreshed');
}
