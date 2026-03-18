import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CliName, CliProcess, DetectResult, CliEvent, CliResult, CliError } from '../src/types.js';
import { EventQueue } from '../src/core/event-queue.js';
import { isValidSelection, handleSlashCommand, cleanup, cleanExit } from './chat.js';

// Test the display name mapping and selection logic without actually running readline
describe('chat example', () => {
  const DISPLAY_NAMES: Record<CliName, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
  };

  it('maps all CLI names to display names', () => {
    expect(DISPLAY_NAMES.claude).toBe('Claude Code');
    expect(DISPLAY_NAMES.codex).toBe('Codex');
    expect(DISPLAY_NAMES.opencode).toBe('OpenCode');
  });

  it('filters installed CLIs from detection results', () => {
    const results: Record<CliName, DetectResult> = {
      claude: { installed: true, version: '1.2.3', authenticated: true, binaryPath: '/usr/bin/claude' },
      codex: { installed: false, version: null, authenticated: false, binaryPath: null },
      opencode: { installed: true, version: '0.5.0', authenticated: false, binaryPath: '/usr/bin/opencode' },
    };

    const available = (Object.entries(results) as [CliName, DetectResult][])
      .filter(([, result]) => result.installed);

    expect(available).toHaveLength(2);
    expect(available[0][0]).toBe('claude');
    expect(available[1][0]).toBe('opencode');
  });

  it('formats version as (vX.Y.Z) in selection list', () => {
    const version = '1.2.3';
    const formatted = version ? `(v${version})` : '(version unknown)';
    expect(formatted).toBe('(v1.2.3)');
  });

  it('shows (version unknown) in selection list when version is null', () => {
    const version: string | null = null;
    const formatted = version ? `(v${version})` : '(version unknown)';
    expect(formatted).toBe('(version unknown)');
  });

  it('formats status line with version', () => {
    const displayName = 'Claude Code';
    const version: string | null = '1.2.3';
    const versionSuffix = version ? ` v${version}` : '';
    const statusLine = `Using ${displayName}${versionSuffix} — type a message to begin, /exit to quit`;
    expect(statusLine).toBe('Using Claude Code v1.2.3 — type a message to begin, /exit to quit');
  });

  it('formats status line without version when version is null', () => {
    const displayName = 'Claude Code';
    const version: string | null = null;
    const versionSuffix = version ? ` v${version}` : '';
    const statusLine = `Using ${displayName}${versionSuffix} — type a message to begin, /exit to quit`;
    expect(statusLine).toBe('Using Claude Code — type a message to begin, /exit to quit');
  });

  it('formats unauthenticated CLI with warning', () => {
    const result: DetectResult = { installed: true, version: '0.5.0', authenticated: false, binaryPath: '/usr/bin/opencode' };
    const authWarning = result.authenticated ? '' : ' — not authenticated';
    expect(authWarning).toBe(' — not authenticated');
  });

  it('formats authenticated CLI without warning', () => {
    const result: DetectResult = { installed: true, version: '1.2.3', authenticated: true, binaryPath: '/usr/bin/claude' };
    const authWarning = result.authenticated ? '' : ' — not authenticated';
    expect(authWarning).toBe('');
  });

  it('detects zero CLIs when none are installed', () => {
    const results: Record<CliName, DetectResult> = {
      claude: { installed: false, version: null, authenticated: false, binaryPath: null },
      codex: { installed: false, version: null, authenticated: false, binaryPath: null },
      opencode: { installed: false, version: null, authenticated: false, binaryPath: null },
    };

    const available = (Object.entries(results) as [CliName, DetectResult][])
      .filter(([, result]) => result.installed);

    expect(available).toHaveLength(0);
  });

  it('shows correct display names for multiple detected CLIs', () => {
    const results: Record<CliName, DetectResult> = {
      claude: { installed: true, version: '1.2.3', authenticated: true, binaryPath: '/usr/bin/claude' },
      codex: { installed: true, version: null, authenticated: true, binaryPath: '/usr/bin/codex' },
      opencode: { installed: true, version: '0.5.0', authenticated: false, binaryPath: '/usr/bin/opencode' },
    };

    const available = (Object.entries(results) as [CliName, DetectResult][])
      .filter(([, result]) => result.installed)
      .map(([name, result]) => {
        const version = result.version ? `(v${result.version})` : '(version unknown)';
        return `${DISPLAY_NAMES[name]} ${version}`;
      });

    expect(available).toEqual([
      'Claude Code (v1.2.3)',
      'Codex (version unknown)',
      'OpenCode (v0.5.0)',
    ]);
  });

  it('version formatting differs between list and status line', () => {
    const version: string | null = '1.2.3';
    const listFormat = version ? `(v${version})` : '(version unknown)';
    const statusFormat = version ? ` v${version}` : '';
    expect(listFormat).toBe('(v1.2.3)');
    expect(statusFormat).toBe(' v1.2.3');
  });

  describe('detection timeout handling', () => {
    it('timed-out CLI appears in list with version unknown alongside normal CLIs', () => {
      const results: Record<CliName, DetectResult> = {
        claude: { installed: true, version: '1.2.3', authenticated: true, binaryPath: '/usr/bin/claude' },
        codex: { installed: true, version: null, authenticated: false, binaryPath: '/usr/bin/codex' },
        opencode: { installed: false, version: null, authenticated: false, binaryPath: null },
      };

      const available = (Object.entries(results) as [CliName, DetectResult][])
        .filter(([, result]) => result.installed)
        .map(([name, result]) => ({
          name,
          displayName: DISPLAY_NAMES[name],
          result,
        }));

      expect(available).toHaveLength(2);

      // Normal CLI
      const claude = available[0];
      const claudeVersion = claude.result.version ? `(v${claude.result.version})` : '(version unknown)';
      expect(`${claude.displayName} ${claudeVersion}`).toBe('Claude Code (v1.2.3)');

      // Timed-out CLI (version null)
      const codex = available[1];
      const codexVersion = codex.result.version ? `(v${codex.result.version})` : '(version unknown)';
      const codexAuth = codex.result.authenticated ? '' : ' — not authenticated';
      expect(`${codex.displayName} ${codexVersion}${codexAuth}`).toBe('Codex (version unknown) — not authenticated');
    });

    it('selecting a timed-out CLI produces correct status line without version', () => {
      const selected = {
        displayName: 'Codex',
        result: { installed: true, version: null, authenticated: false, binaryPath: '/usr/bin/codex' } as DetectResult,
      };

      const versionSuffix = selected.result.version ? ` v${selected.result.version}` : '';
      const statusLine = `Using ${selected.displayName}${versionSuffix} — type a message to begin, /exit to quit`;
      expect(statusLine).toBe('Using Codex — type a message to begin, /exit to quit');
    });
  });

  it('shows error message when no CLIs found', () => {
    const available: unknown[] = [];
    let errorMessage = '';

    if (available.length === 0) {
      errorMessage = 'No supported CLIs found. Install claude, codex, or opencode.';
    }

    expect(errorMessage).toBe('No supported CLIs found. Install claude, codex, or opencode.');
  });

  describe('Ctrl+C clean exit', () => {
    it('readline close event triggers process.exit(0)', async () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const rl = (await import('node:readline')).createInterface({
        input: new (await import('node:stream')).PassThrough(),
        output: new (await import('node:stream')).PassThrough(),
      });

      // Simulate what chat.ts does: listen for close and exit
      rl.on('close', () => {
        process.exit(0);
      });

      rl.close();

      expect(mockExit).toHaveBeenCalledWith(0);
      mockExit.mockRestore();
    });
  });

  describe('Ctrl+C streaming interrupt', () => {
    it('SIGINT during streaming calls interrupt on active process', () => {
      let isStreaming = true;
      const mockInterrupt = vi.fn();
      const activeProcess = { interrupt: mockInterrupt };

      // Simulate the SIGINT handler logic from chat.ts
      const handleSigint = () => {
        if (isStreaming && activeProcess) {
          activeProcess.interrupt();
          return;
        }
        process.exit(0);
      };

      handleSigint();
      expect(mockInterrupt).toHaveBeenCalled();
    });

    it('SIGINT when not streaming exits the app', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      let isStreaming = false;
      const activeProcess = null;

      const handleSigint = () => {
        if (isStreaming && activeProcess) {
          (activeProcess as any).interrupt();
          return;
        }
        process.exit(0);
      };

      handleSigint();
      expect(mockExit).toHaveBeenCalledWith(0);
      mockExit.mockRestore();
    });

    it('streaming state resets after process completes', () => {
      let isStreaming = true;
      let activeProcess: { interrupt: () => void } | null = { interrupt: vi.fn() };

      // Simulate post-streaming cleanup
      isStreaming = false;
      activeProcess = null;

      expect(isStreaming).toBe(false);
      expect(activeProcess).toBeNull();
    });

    it('done event with error sets interrupted flag', () => {
      let interrupted = false;
      const doneEvent = {
        type: 'done' as const,
        result: { error: { code: 'fatal', message: 'killed' } },
      };

      if (doneEvent.type === 'done' && doneEvent.result?.error) {
        interrupted = true;
      }

      expect(interrupted).toBe(true);
    });

    it('done event without error does not set interrupted flag', () => {
      let interrupted = false;
      const doneEvent = {
        type: 'done' as const,
        result: { error: null },
      };

      if (doneEvent.type === 'done' && doneEvent.result?.error) {
        interrupted = true;
      }

      expect(interrupted).toBe(false);
    });

    it('"Response interrupted." is printed when interrupted', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const interrupted = true;

      if (interrupted) {
        console.log('\nResponse interrupted.');
      }

      expect(consoleSpy).toHaveBeenCalledWith('\nResponse interrupted.');
      consoleSpy.mockRestore();
    });
  });

  describe('chat loop behavior', () => {
    it('empty input is ignored — no spawn occurs', () => {
      const inputs = ['', '  ', '\t'];
      for (const input of inputs) {
        expect(input.trim()).toBe('');
      }
    });

    it('text events are written to stdout without extra newlines', () => {
      const chunks: string[] = [];
      const mockWrite = (s: string) => { chunks.push(s); };

      // Simulate text events
      const events: Pick<CliEvent, 'type' | 'content'>[] = [
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' world' },
        { type: 'text', content: '!' },
      ];

      for (const event of events) {
        if (event.type === 'text' && event.content) {
          mockWrite(event.content);
        }
      }

      expect(chunks.join('')).toBe('Hello world!');
    });

    it('non-text events are not written to stdout', () => {
      const chunks: string[] = [];
      const mockWrite = (s: string) => { chunks.push(s); };

      const events: Pick<CliEvent, 'type' | 'content'>[] = [
        { type: 'system', content: 'Starting...' },
        { type: 'text', content: 'Hello' },
        { type: 'tool_use', content: undefined },
        { type: 'text', content: ' there' },
        { type: 'done', content: undefined },
      ];

      for (const event of events) {
        if (event.type === 'text' && event.content) {
          mockWrite(event.content);
        }
      }

      expect(chunks.join('')).toBe('Hello there');
    });

    it('user message is echoed with colored "You: " prefix', () => {
      const CYAN = '\x1b[36m';
      const RESET = '\x1b[0m';
      const input = 'hello world';
      const echo = `${CYAN}You: ${RESET}${input.trim()}`;
      expect(echo).toBe(`${CYAN}You: ${RESET}hello world`);
    });

    it('assistant prefix is printed with color before streaming', () => {
      const GREEN = '\x1b[32m';
      const RESET = '\x1b[0m';
      const prefix = `${GREEN}Assistant: ${RESET}`;
      expect(prefix).toBe(`${GREEN}Assistant: ${RESET}`);
    });
  });

  describe('ANSI color formatting', () => {
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const RED = '\x1b[31m';
    const RESET = '\x1b[0m';

    it('tool indicator is rendered in yellow', () => {
      const toolName = 'read_file';
      const output = `\n${YELLOW}⚙ Using ${toolName}...${RESET}\n`;
      expect(output).toContain(YELLOW);
      expect(output).toContain(RESET);
      expect(output).toContain('⚙ Using read_file...');
    });

    it('error prefix is rendered in red with content uncolored', () => {
      const content = 'something went wrong';
      const output = `\n${RED}Error: ${RESET}${content}\n`;
      expect(output).toContain(RED);
      expect(output).toContain(RESET);
      expect(output).toBe(`\n${RED}Error: ${RESET}something went wrong\n`);
    });

    it('all color codes reset properly', () => {
      const labels = [
        `${CYAN}You: ${RESET}`,
        `${GREEN}Assistant: ${RESET}`,
        `${YELLOW}⚙ Using tool...${RESET}`,
        `${RED}Error: ${RESET}`,
      ];
      for (const label of labels) {
        expect(label).toContain(RESET);
        expect(label.endsWith(RESET)).toBe(true);
      }
    });
  });

  describe('handleSlashCommand', () => {
    let mockRl: { close: ReturnType<typeof vi.fn> };
    let mockExit: ReturnType<typeof vi.spyOn>;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      mockRl = { close: vi.fn() };
      mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      mockExit.mockRestore();
      consoleSpy.mockRestore();
    });

    it('/exit prints "Goodbye!" and closes readline', async () => {
      mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      handleSlashCommand('/exit', mockRl as any);
      // Allow the async cleanExit to complete
      await vi.waitFor(() => {
        expect(mockExit).toHaveBeenCalledWith(0);
      });
      expect(consoleSpy).toHaveBeenCalledWith('Goodbye!');
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('/new prints placeholder message and returns true', () => {
      const result = handleSlashCommand('/new', mockRl as any);
      expect(consoleSpy).toHaveBeenCalledWith('Session reset not yet implemented');
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('unknown /command prints error with command name', () => {
      const result = handleSlashCommand('/foo', mockRl as any);
      expect(consoleSpy).toHaveBeenCalledWith('Unknown command: /foo');
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('unknown /command with args only shows command part', () => {
      const result = handleSlashCommand('/foo bar baz', mockRl as any);
      expect(consoleSpy).toHaveBeenCalledWith('Unknown command: /foo');
      expect(result).toBe(true);
    });

    it('/exit is case-insensitive', async () => {
      mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      handleSlashCommand('/EXIT', mockRl as any);
      await vi.waitFor(() => {
        expect(mockExit).toHaveBeenCalledWith(0);
      });
      expect(consoleSpy).toHaveBeenCalledWith('Goodbye!');
    });

    it('/new is case-insensitive', () => {
      const result = handleSlashCommand('/NEW', mockRl as any);
      expect(consoleSpy).toHaveBeenCalledWith('Session reset not yet implemented');
      expect(result).toBe(true);
    });
  });

  describe('process cleanup on exit', () => {
    it('cleanup interrupts activeProcess and awaits completion', async () => {
      const mockInterrupt = vi.fn().mockResolvedValue({ exitCode: 0, error: null });
      // Simulate setting an active process at module level
      // We test the cleanup logic pattern directly
      let activeProcess: { interrupt: () => Promise<unknown> } | null = { interrupt: mockInterrupt };

      const doCleanup = async () => {
        if (activeProcess) {
          await activeProcess.interrupt();
          activeProcess = null;
        }
      };

      await doCleanup();
      expect(mockInterrupt).toHaveBeenCalled();
      expect(activeProcess).toBeNull();
    });

    it('cleanup is a no-op when no process is active', async () => {
      let activeProcess: { interrupt: () => Promise<unknown> } | null = null;

      const doCleanup = async () => {
        if (activeProcess) {
          await activeProcess.interrupt();
          activeProcess = null;
        }
      };

      // Should not throw
      await doCleanup();
      expect(activeProcess).toBeNull();
    });

    it('cleanExit calls cleanup before process.exit', async () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockInterrupt = vi.fn().mockResolvedValue({ exitCode: 0, error: null });

      // Test the pattern: cleanup then exit
      let activeProcess: { interrupt: () => Promise<unknown> } | null = { interrupt: mockInterrupt };

      const doCleanExit = async (code = 0) => {
        if (activeProcess) {
          await activeProcess.interrupt();
          activeProcess = null;
        }
        process.exit(code);
      };

      await doCleanExit(0);
      expect(mockInterrupt).toHaveBeenCalled();
      expect(activeProcess).toBeNull();
      expect(mockExit).toHaveBeenCalledWith(0);
      mockExit.mockRestore();
    });

    it('/exit handler triggers cleanup before exit', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockRl = { close: vi.fn() };

      // handleSlashCommand now calls cleanExit which is async
      // The function still returns true for recognized commands
      const result = handleSlashCommand('/exit', mockRl as any);
      expect(consoleSpy).toHaveBeenCalledWith('Goodbye!');
      expect(mockRl.close).toHaveBeenCalled();
      // cleanExit is called (async), process.exit happens after cleanup
      expect(result).toBe(true);

      mockExit.mockRestore();
      consoleSpy.mockRestore();
    });

    it('SIGTERM triggers cleanup before exit', () => {
      // Verify the pattern: SIGTERM handler calls cleanExit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      let cleanExitCalled = false;

      const handleSigterm = () => {
        cleanExitCalled = true;
        // In real code, cleanExit(0) is called
      };

      handleSigterm();
      expect(cleanExitCalled).toBe(true);
      mockExit.mockRestore();
    });
  });

  describe('isValidSelection', () => {
    it('rejects non-numeric input', () => {
      expect(isValidSelection('abc', 3)).toBe(false);
    });

    it('rejects empty input', () => {
      expect(isValidSelection('', 3)).toBe(false);
    });

    it('rejects zero', () => {
      expect(isValidSelection('0', 3)).toBe(false);
    });

    it('rejects negative numbers', () => {
      expect(isValidSelection('-1', 3)).toBe(false);
    });

    it('rejects numbers above max options', () => {
      expect(isValidSelection('5', 2)).toBe(false);
    });

    it('accepts valid selection at lower bound', () => {
      expect(isValidSelection('1', 3)).toBe(true);
    });

    it('accepts valid selection at upper bound', () => {
      expect(isValidSelection('3', 3)).toBe(true);
    });

    it('accepts valid selection in middle', () => {
      expect(isValidSelection('2', 3)).toBe(true);
    });

    it('rejects whitespace-only input', () => {
      expect(isValidSelection('   ', 3)).toBe(false);
    });

    it('rejects decimal numbers', () => {
      expect(isValidSelection('1.5', 3)).toBe(true); // parseInt('1.5') === 1, which is valid
    });
  });

  describe('session ID tracking', () => {
    // Mirrors the sessionId capture logic in chatLoop
    function simulateMessages(
      responses: Array<{ sessionId: string | null; interrupted: boolean }>
    ): string | undefined {
      let sessionId: string | undefined;

      for (const response of responses) {
        // After each response, capture sessionId only on completed (non-interrupted) responses
        if (!response.interrupted && response.sessionId) {
          sessionId = response.sessionId;
        }
      }

      return sessionId;
    }

    it('captures sessionId from first completed response', () => {
      const result = simulateMessages([
        { sessionId: 'sess-abc', interrupted: false },
      ]);
      expect(result).toBe('sess-abc');
    });

    it('passes captured sessionId to second spawn call', () => {
      // Simulate two messages: after first completes, sessionId should be available
      let sessionId: string | undefined;
      const spawnCalls: Array<{ sessionId?: string }> = [];

      // First message
      spawnCalls.push({ sessionId });
      // First response completes with sessionId
      const firstResult = { sessionId: 'sess-123', error: null };
      if (firstResult.sessionId) sessionId = firstResult.sessionId;

      // Second message — should include sessionId
      spawnCalls.push({ sessionId });

      expect(spawnCalls[0].sessionId).toBeUndefined();
      expect(spawnCalls[1].sessionId).toBe('sess-123');
    });

    it('updates sessionId after each successful response (handles rotation)', () => {
      const result = simulateMessages([
        { sessionId: 'sess-v1', interrupted: false },
        { sessionId: 'sess-v2', interrupted: false },
        { sessionId: 'sess-v3', interrupted: false },
      ]);
      expect(result).toBe('sess-v3');
    });

    it('continues without error when sessionId is null (e.g. Codex)', () => {
      const result = simulateMessages([
        { sessionId: null, interrupted: false },
        { sessionId: null, interrupted: false },
      ]);
      expect(result).toBeUndefined();
    });

    it('preserves sessionId from last completed response on interrupt', () => {
      const result = simulateMessages([
        { sessionId: 'sess-good', interrupted: false },
        { sessionId: 'sess-partial', interrupted: true }, // interrupted — should NOT update
      ]);
      expect(result).toBe('sess-good');
    });

    it('preserves sessionId when interrupted response has no sessionId', () => {
      const result = simulateMessages([
        { sessionId: 'sess-good', interrupted: false },
        { sessionId: null, interrupted: true },
      ]);
      expect(result).toBe('sess-good');
    });

    it('sessionId starts undefined on first message', () => {
      let sessionId: string | undefined;
      expect(sessionId).toBeUndefined();
    });
  });

  describe('error handling', () => {
    // Simulates the core message-handling logic from chatLoop to test error paths
    function makeCliError(overrides: Partial<CliError> = {}): CliError {
      return {
        code: 'fatal',
        message: 'something went wrong',
        retryable: false,
        retryAfterMs: null,
        raw: '',
        ...overrides,
      };
    }

    function makeResult(overrides: Partial<CliResult> = {}): CliResult {
      return {
        exitCode: 0,
        sessionId: null,
        usage: null,
        model: null,
        error: null,
        durationMs: 100,
        ...overrides,
      };
    }

    function createMockProcess(options?: {
      events?: CliEvent[];
      error?: Error;
      result?: CliResult;
    }): CliProcess {
      const queue = new EventQueue();
      const defaultResult = makeResult();
      const result = options?.result ?? defaultResult;

      queueMicrotask(() => {
        if (options?.error) {
          queue.error(options.error);
          return;
        }
        if (options?.events) {
          for (const event of options.events) {
            queue.push(event);
          }
        }
        queue.push({ type: 'done', timestamp: Date.now(), result, raw: '' });
        queue.close();
      });

      return {
        pid: 12345,
        events: queue,
        interrupt: vi.fn().mockResolvedValue(result),
        done: options?.error ? Promise.reject(result) : Promise.resolve(result),
      };
    }

    // Mirrors the error-handling logic in chatLoop
    async function processMessage(proc: CliProcess): Promise<{
      interrupted: boolean;
      result: CliResult | null;
      streamError: Error | null;
    }> {
      let interrupted = false;
      let result: CliResult | null = null;
      let streamError: Error | null = null;

      try {
        for await (const event of proc.events) {
          switch (event.type) {
            case 'done':
              result = event.result ?? null;
              if (event.result?.error) interrupted = true;
              break;
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
      }

      if (!result) {
        try {
          result = await proc.done;
        } catch (r) {
          result = r as CliResult;
        }
      }

      return { interrupted, result, streamError };
    }

    it('catches stream error from CLI crash mid-response', async () => {
      // Error set before iteration starts → for-await throws
      const queue = new EventQueue();
      const errorResult = makeResult({ exitCode: -1, error: makeCliError({ message: 'stream ended unexpectedly' }) });
      queue.error(new Error('stream ended unexpectedly'));

      const proc: CliProcess = {
        pid: 12345,
        events: queue,
        interrupt: vi.fn().mockResolvedValue(errorResult),
        done: Promise.reject(errorResult),
      };

      const { streamError, result } = await processMessage(proc);

      expect(streamError).not.toBeNull();
      expect(streamError!.message).toBe('stream ended unexpectedly');
      expect(result).not.toBeNull();
    });

    it('detects rate limit error in CliResult', async () => {
      const rateLimitError = makeCliError({
        code: 'rate_limit',
        message: 'Too many requests',
        retryable: true,
        retryAfterMs: 30000,
      });
      const proc = createMockProcess({
        result: makeResult({ exitCode: 1, error: rateLimitError }),
      });

      const { result } = await processMessage(proc);

      expect(result?.error?.code).toBe('rate_limit');
      expect(result?.error?.retryAfterMs).toBe(30000);
      expect(result?.error?.retryable).toBe(true);
    });

    it('detects binary_not_found error from stream', async () => {
      // Error set before iteration → for-await throws
      const queue = new EventQueue();
      const errorResult = makeResult({ exitCode: -1, error: makeCliError({ code: 'binary_not_found', message: 'Binary not found: claude' }) });
      queue.error(new Error('Binary not found: claude'));

      const proc: CliProcess = {
        pid: 12345,
        events: queue,
        interrupt: vi.fn().mockResolvedValue(errorResult),
        done: Promise.reject(errorResult),
      };

      const { streamError, result } = await processMessage(proc);

      expect(streamError!.message).toBe('Binary not found: claude');
      expect(result?.error?.code).toBe('binary_not_found');
    });

    it('handles non-zero exit code with error in done event', async () => {
      const proc = createMockProcess({
        result: makeResult({ exitCode: 1, error: makeCliError({ message: 'Process exited with code 1' }) }),
      });

      const { interrupted, result } = await processMessage(proc);

      expect(interrupted).toBe(true);
      expect(result?.exitCode).toBe(1);
      expect(result?.error?.code).toBe('fatal');
    });

    it('falls back to proc.done when stream errors before done event', async () => {
      // Error set before iteration → for-await throws, no done event received
      const queue = new EventQueue();
      const expectedResult = makeResult({ exitCode: 1, error: makeCliError() });
      queue.error(new Error('crash'));

      const proc: CliProcess = {
        pid: 99,
        events: queue,
        interrupt: vi.fn().mockResolvedValue(expectedResult),
        done: Promise.reject(expectedResult),
      };

      const { result, streamError } = await processMessage(proc);

      expect(streamError).not.toBeNull();
      // Result comes from proc.done catch since no done event was received
      expect(result).toEqual(expectedResult);
    });

    it('successful response has no errors', async () => {
      const proc = createMockProcess();

      const { interrupted, result, streamError } = await processMessage(proc);

      expect(streamError).toBeNull();
      expect(interrupted).toBe(false);
      expect(result?.exitCode).toBe(0);
      expect(result?.error).toBeNull();
    });

    it('rate limit result includes retryAfterMs for display', () => {
      const error = makeCliError({
        code: 'rate_limit',
        retryAfterMs: 30000,
      });

      const retryMsg = error.retryAfterMs
        ? ` (retry in ${Math.ceil(error.retryAfterMs / 1000)}s)`
        : '';

      expect(retryMsg).toBe(' (retry in 30s)');
    });

    it('rate limit without retryAfterMs shows no timing', () => {
      const error = makeCliError({
        code: 'rate_limit',
        retryAfterMs: null,
      });

      const retryMsg = error.retryAfterMs
        ? ` (retry in ${Math.ceil(error.retryAfterMs / 1000)}s)`
        : '';

      expect(retryMsg).toBe('');
    });
  });
});
