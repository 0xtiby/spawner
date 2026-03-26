import type { CliName, KnownModel, ListModelsOptions } from './types.js';
import { ensureCache, refreshCache } from './core/models-catalog.js';
import { ensureCliModelsCache, refreshCliModelsCache } from './core/cli-models.js';
import { createDebugLogger } from './core/debug.js';

const log = createDebugLogger();

export const CLI_PROVIDER_MAP: Record<'claude' | 'codex', string> = {
  claude: 'anthropic',
  codex: 'openai',
};

export async function listModels(options?: ListModelsOptions): Promise<KnownModel[]> {
  // OpenCode: use CLI-based model discovery
  if (options?.cli === 'opencode') {
    log?.('listModels: using CLI discovery for opencode');
    const cliCache = await ensureCliModelsCache();
    let models = [...cliCache.data];

    if (options.provider) {
      log?.(`listModels: filtering CLI models by provider=${options.provider}`);
      models = models.filter(m => m.provider === options.provider);
    }

    models.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    log?.(`listModels: returning ${models.length} CLI models`);
    return models;
  }

  // Claude, Codex, or no CLI: use models.dev
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
    providerFilter = CLI_PROVIDER_MAP[options.cli as keyof typeof CLI_PROVIDER_MAP];
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
  log?.('refreshModels: refreshing both caches');
  const results = await Promise.allSettled([
    refreshCache(),
    refreshCliModelsCache(),
  ]);

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length === results.length) {
    throw failures[0].reason;
  }
  log?.('refreshModels: caches refreshed');
}
