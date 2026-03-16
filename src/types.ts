// --- Union types ---

export type CliName = 'claude' | 'codex' | 'opencode';

export type CliEventType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'system'
  | 'done';

export type CliErrorCode =
  | 'rate_limit'
  | 'auth'
  | 'session_not_found'
  | 'model_not_found'
  | 'context_overflow'
  | 'permission_denied'
  | 'binary_not_found'
  | 'fatal'
  | 'unknown';

// --- Interfaces ---

export interface SpawnOptions {
  cli: CliName;
  prompt: string;
  cwd: string;
  model?: string;
  sessionId?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  autoApprove?: boolean;
  forkSession?: boolean;
  continueSession?: boolean;
  addDirs?: string[];
  ephemeral?: boolean;
  verbose?: boolean;
  abortSignal?: AbortSignal;
  extraArgs?: string[];
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
}

export interface CliError {
  code: CliErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs: number | null;
  raw: string;
}

export interface CliResult {
  exitCode: number;
  sessionId: string | null;
  usage: TokenUsage | null;
  model: string | null;
  error: CliError | null;
  durationMs: number;
}

export interface CliEvent {
  type: CliEventType;
  timestamp: number;
  content?: string;
  tool?: {
    name: string;
    input?: Record<string, unknown>;
  };
  toolResult?: {
    name: string;
    output?: string;
    error?: string;
  };
  result?: CliResult;
  raw: string;
}

export interface CliProcess {
  events: AsyncIterable<CliEvent>;
  pid: number;
  interrupt(graceMs?: number): Promise<CliResult>;
  done: Promise<CliResult>;
}

export interface DetectResult {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  binaryPath: string | null;
}

export interface ExtractOptions {
  cli: CliName;
  rawOutput: string;
}

export interface ListModelsOptions {
  cli?: CliName;
  provider?: string;
}

export interface KnownModel {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'other';
  cli: CliName[];
  contextWindow: number | null;
  supportsEffort: boolean;
}
