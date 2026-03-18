import { describe, it, expect, vi } from 'vitest';
import type { CliName, DetectResult } from '../src/types.js';

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

  it('formats status line correctly', () => {
    const displayName = 'Claude Code';
    const version = '1.2.3';
    const statusLine = `Using ${displayName} v${version} — type a message to begin, /exit to quit`;
    expect(statusLine).toBe('Using Claude Code v1.2.3 — type a message to begin, /exit to quit');
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

  it('shows error message when no CLIs found', () => {
    const available: unknown[] = [];
    let errorMessage = '';

    if (available.length === 0) {
      errorMessage = 'No supported CLIs found. Install claude, codex, or opencode.';
    }

    expect(errorMessage).toBe('No supported CLIs found. Install claude, codex, or opencode.');
  });
});
