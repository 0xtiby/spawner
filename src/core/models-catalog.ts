import type { KnownModel } from '../types.js';
import { createDebugLogger } from './debug.js';

// --- Debug logger (activated via NODE_DEBUG=spawner) ---

const log = createDebugLogger();

// --- Constants ---

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

// --- Internal types ---

export interface ModelsDevRawModel {
  id: string;
  name: string;
  reasoning?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
}

export interface ModelsDevRawProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevRawModel>;
}

export type ModelsDevRawResponse = Record<string, ModelsDevRawProvider>;

export interface ModelsCache {
  data: Map<string, KnownModel[]>;
  fetchedAt: number;
  stale: boolean;
}

// --- Error class ---

export class ModelsFetchError extends Error {
  readonly statusCode?: number;
  override readonly cause?: Error;

  constructor(message: string, options?: { statusCode?: number; cause?: Error }) {
    super(message);
    this.name = 'ModelsFetchError';
    this.statusCode = options?.statusCode;
    this.cause = options?.cause;
  }
}

// --- Module-level state ---

let cache: ModelsCache | null = null;
let inflight: Promise<ModelsCache> | null = null;

// --- Provider mapping ---

const KNOWN_PROVIDERS = new Set(['anthropic', 'openai']);

function mapProvider(providerId: string): 'anthropic' | 'openai' | 'other' {
  return KNOWN_PROVIDERS.has(providerId) ? (providerId as 'anthropic' | 'openai') : 'other';
}

// --- Transform functions ---

export function toKnownModel(providerId: string, raw: ModelsDevRawModel): KnownModel {
  return {
    id: raw.id,
    name: raw.name,
    provider: mapProvider(providerId),
    cli: [],
    contextWindow: raw.limit?.context ?? null,
    supportsEffort: raw.reasoning ?? false,
  };
}

export function transformCatalog(raw: ModelsDevRawResponse): Map<string, KnownModel[]> {
  const result = new Map<string, KnownModel[]>();

  for (const [providerId, provider] of Object.entries(raw)) {
    if (!provider || typeof provider !== 'object' || !provider.models || typeof provider.models !== 'object') {
      continue;
    }

    const models: KnownModel[] = [];
    for (const rawModel of Object.values(provider.models)) {
      models.push(toKnownModel(providerId, rawModel));
    }
    result.set(providerId, models);
  }

  return result;
}

// --- Fetch ---

export async function fetchCatalog(): Promise<ModelsDevRawResponse> {
  const startTime = Date.now();
  log?.(`fetchCatalog: fetching ${MODELS_DEV_URL}`);

  let response: Response;
  try {
    response = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ModelsFetchError('Failed to fetch models catalog', {
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }

  log?.(`fetchCatalog: HTTP ${response.status} (${Date.now() - startTime}ms)`);

  if (!response.ok) {
    throw new ModelsFetchError(`HTTP ${response.status} ${response.statusText}`, {
      statusCode: response.status,
    });
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    throw new ModelsFetchError(`Response too large: ${contentLength} bytes exceeds ${MAX_RESPONSE_BYTES} limit`);
  }

  const text = await response.text();

  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ModelsFetchError(`Response body too large: ${text.length} bytes exceeds ${MAX_RESPONSE_BYTES} limit`);
  }

  log?.(`fetchCatalog: ${text.length} bytes, ${Date.now() - startTime}ms total`);

  try {
    return JSON.parse(text) as ModelsDevRawResponse;
  } catch (err) {
    throw new ModelsFetchError('Invalid JSON response', {
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

// --- Cache management ---

export function getCache(): ModelsCache | null {
  return cache;
}

export function clearCache(): void {
  cache = null;
}

function isCacheExpired(): boolean {
  if (!cache) return true;
  return Date.now() - cache.fetchedAt >= CACHE_TTL_MS;
}

export async function ensureCache(): Promise<ModelsCache> {
  if (cache && !isCacheExpired()) {
    log?.('ensureCache: cache hit');
    return cache;
  }

  if (inflight) {
    log?.('ensureCache: joining inflight fetch');
    return inflight;
  }

  log?.('ensureCache: cache miss, fetching');

  inflight = (async () => {
    try {
      const raw = await fetchCatalog();
      const data = transformCatalog(raw);
      cache = { data, fetchedAt: Date.now(), stale: false };
      return cache;
    } catch (err) {
      if (cache) {
        log?.('ensureCache: fetch failed, returning stale cache');
        cache = { ...cache, stale: true };
        return cache;
      }
      throw err instanceof ModelsFetchError
        ? err
        : new ModelsFetchError('Failed to fetch models catalog', {
            cause: err instanceof Error ? err : new Error(String(err)),
          });
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function invalidateAndFetch(): Promise<ModelsCache> {
  try {
    const raw = await fetchCatalog();
    const data = transformCatalog(raw);
    cache = { data, fetchedAt: Date.now(), stale: false };
    return cache;
  } catch (err) {
    throw err instanceof ModelsFetchError
      ? err
      : new ModelsFetchError('Failed to fetch models catalog', {
          cause: err instanceof Error ? err : new Error(String(err)),
        });
  }
}
