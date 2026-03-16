import type { CliName } from '../types.js';
import type { CliAdapter } from './types.js';

function stub(name: CliName): CliAdapter {
  const notImplemented = () => { throw new Error(`${name} adapter not implemented`); };
  return {
    name,
    buildCommand: notImplemented,
    parseLine: notImplemented,
    detect: notImplemented,
    classifyError: notImplemented,
  } as unknown as CliAdapter;
}

const adapters: Record<CliName, CliAdapter> = {
  claude: stub('claude'),
  codex: stub('codex'),
  opencode: stub('opencode'),
};

export function getAdapter(cli: CliName): CliAdapter {
  return adapters[cli];
}
