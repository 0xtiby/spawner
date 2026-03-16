import type { CliName, KnownModel, ListModelsOptions } from './types.js';

export const KNOWN_MODELS: KnownModel[] = [
  // Claude Code
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    cli: ['claude'],
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    cli: ['claude'],
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    cli: ['claude'],
    contextWindow: 200_000,
    supportsEffort: false,
  },
  // Codex
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'openai',
    cli: ['codex'],
    contextWindow: 200_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    cli: ['codex'],
    contextWindow: 128_000,
    supportsEffort: false,
  },
  // OpenCode
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4 (OpenCode)',
    provider: 'anthropic',
    cli: ['opencode'],
    contextWindow: 200_000,
    supportsEffort: false,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1 (OpenCode)',
    provider: 'openai',
    cli: ['opencode'],
    contextWindow: 128_000,
    supportsEffort: false,
  },
];

export function getKnownModels(cli?: CliName): KnownModel[] {
  if (!cli) return KNOWN_MODELS;
  return KNOWN_MODELS.filter(m => m.cli.includes(cli));
}

export function listModels(options?: ListModelsOptions): KnownModel[] {
  let models: KnownModel[] = KNOWN_MODELS;
  if (options?.cli) {
    models = models.filter(m => m.cli.includes(options.cli!));
  }
  if (options?.provider) {
    models = models.filter(m => m.provider === options.provider);
  }
  return models;
}
