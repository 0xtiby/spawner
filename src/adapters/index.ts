import type { CliName } from '../types.js';
import type { CliAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';

const adapters: Record<CliName, CliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  pi: piAdapter,
};

export function getAdapter(cli: CliName): CliAdapter {
  return adapters[cli];
}
