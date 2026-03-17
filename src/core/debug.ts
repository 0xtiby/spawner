export type DebugLog = (msg: string) => void;

const NODE_DEBUG_ENABLED = process.env.NODE_DEBUG?.includes('spawner') ?? false;

export function createDebugLogger(verbose?: boolean): DebugLog | null {
  if (!verbose && !NODE_DEBUG_ENABLED) return null;
  return (msg: string) => process.stderr.write(`[spawner] ${msg}\n`);
}
