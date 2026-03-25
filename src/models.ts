import type { CliName, KnownModel, ListModelsOptions } from './types.js';

export const CLI_PROVIDER_MAP: Record<CliName, string | null> = {
  claude: 'anthropic',
  codex: 'openai',
  opencode: null,
};

export const KNOWN_MODELS: KnownModel[] = [
  // Claude Code
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsEffort: false,
  },
  // Codex
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'openai',
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    contextWindow: 128_000,
    supportsEffort: false,
  },
  // OpenCode
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4 (OpenCode)',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsEffort: false,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1 (OpenCode)',
    provider: 'openai',
    contextWindow: 128_000,
    supportsEffort: false,
  },
];

export function getKnownModels(): KnownModel[] {
  return KNOWN_MODELS;
}

export function listModels(options?: ListModelsOptions): KnownModel[] {
  let models: KnownModel[] = KNOWN_MODELS;
  if (options?.provider) {
    models = models.filter(m => m.provider === options.provider);
  }
  return models;
}
