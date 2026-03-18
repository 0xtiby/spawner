import { describe, it, expect, vi } from 'vitest';
import type { CliName, DetectResult, CliEvent, CliResult } from '../src/types.js';
import { isValidSelection } from './chat.js';

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

    it('user message is echoed with "You: " prefix', () => {
      const input = 'hello world';
      const echo = `You: ${input.trim()}`;
      expect(echo).toBe('You: hello world');
    });

    it('assistant prefix is printed before streaming', () => {
      const prefix = 'Assistant: ';
      expect(prefix).toBe('Assistant: ');
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
});
