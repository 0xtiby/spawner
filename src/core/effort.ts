import type { CliName, EffortLevel } from '../types.js';

export interface EffortFlag {
  flag: string;
  value: string;
}

export function mapEffortToCliFlag(cli: CliName, effort: EffortLevel): EffortFlag | null {
  switch (cli) {
    case 'claude': {
      if (effort === 'off' || effort === 'minimal') return null;
      const value = effort === 'xhigh' ? 'max' : effort;
      return { flag: '--effort', value };
    }
    case 'codex': {
      if (effort === 'off' || effort === 'minimal') return null;
      const mapped = effort === 'max' || effort === 'xhigh' ? 'high' : effort;
      return { flag: '-c', value: `model_reasoning_effort=${mapped}` };
    }
    case 'pi': {
      const value = effort === 'max' || effort === 'xhigh' ? 'xhigh' : effort;
      return { flag: '--thinking', value };
    }
    case 'opencode':
      return null;
  }
}
