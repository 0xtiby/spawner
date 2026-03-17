import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMockProcess, type MockChildProcess } from '../helpers/mock-process.js';

// Queue of mock processes — detect() calls execCommand() multiple times (version, then auth)
const mockQueue: MockChildProcess[] = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockQueue.shift()!),
}));

// Import after mock registration
const { detect, detectAll, execCommand } = await import('../../src/core/detect.js');

function createEnoentProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = 88888;
  proc.killed = false;
  proc.kill = () => { proc.killed = true; return true; };

  setImmediate(() => {
    const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    proc.stdout.end();
    proc.stderr.end();
    proc.emit('error', err);
  });

  return proc;
}

function createHangingProcess(): MockChildProcess {
  // Process that never emits close — simulates timeout
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = 77777;
  proc.killed = false;
  proc.kill = (signal?: string) => {
    if (proc.killed) return false;
    proc.killed = true;
    proc.emit('close', signal === 'SIGKILL' ? 137 : 143, signal ?? 'SIGTERM');
    return true;
  };

  return proc;
}

describe('detect (mocked child_process)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue.length = 0;
  });

  describe('installed + authenticated', () => {
    it('returns full positive DetectResult when version and auth succeed', async () => {
      // Version check — exits 0 with version string
      mockQueue.push(createMockProcess({ stdoutLines: ['claude-code 1.0.12'], exitCode: 0 }));
      // Auth check — exits 0
      mockQueue.push(createMockProcess({ stdoutLines: ['Authenticated'], exitCode: 0 }));

      const result = await detect('claude');

      expect(result).toEqual({
        installed: true,
        version: 'claude-code 1.0.12',
        authenticated: true,
        binaryPath: 'claude',
      });
    });
  });

  describe('not installed', () => {
    it('returns installed: false when version check gets ENOENT', async () => {
      mockQueue.push(createEnoentProcess());

      const result = await detect('claude');

      expect(result).toEqual({
        installed: false,
        version: null,
        authenticated: false,
        binaryPath: null,
      });
    });
  });

  describe('installed, not authenticated', () => {
    it('returns authenticated: false when auth check exits non-zero', async () => {
      // Version check succeeds
      mockQueue.push(createMockProcess({ stdoutLines: ['claude-code 1.0.12'], exitCode: 0 }));
      // Auth check fails with exit code 1
      mockQueue.push(createMockProcess({ stdoutLines: [], stderrLines: ['Not authenticated'], exitCode: 1 }));

      const result = await detect('claude');

      expect(result).toEqual({
        installed: true,
        version: 'claude-code 1.0.12',
        authenticated: false,
        binaryPath: 'claude',
      });
    });
  });

  describe('timeout', () => {
    it('returns version: null when version check times out', async () => {
      vi.useFakeTimers();

      mockQueue.push(createHangingProcess());

      const promise = detect('claude');

      // Advance past the 10s timeout
      await vi.advanceTimersByTimeAsync(11_000);

      const result = await promise;

      expect(result).toEqual({
        installed: true,
        version: null,
        authenticated: false,
        binaryPath: 'claude',
      });

      vi.useRealTimers();
    });
  });

  describe('detectAll', () => {
    it('checks all three CLIs concurrently, returns Record', async () => {
      // Route mock processes by binary name + args (concurrent calls make queue order unpredictable)
      const { spawn: mockSpawn } = await import('node:child_process');
      const spawnFn = vi.mocked(mockSpawn);

      spawnFn.mockImplementation((bin: string, args?: readonly string[]) => {
        const isVersion = args?.includes('--version');

        if (bin === 'claude') {
          if (isVersion) return createMockProcess({ stdoutLines: ['claude-code 1.0.12'], exitCode: 0 }) as any;
          return createMockProcess({ stdoutLines: ['OK'], exitCode: 0 }) as any; // auth
        }
        if (bin === 'codex') {
          if (isVersion) return createEnoentProcess() as any;
          return createMockProcess({ stdoutLines: [], exitCode: 1 }) as any; // shouldn't reach
        }
        // opencode
        if (isVersion) return createMockProcess({ stdoutLines: ['opencode v0.5.0'], exitCode: 0 }) as any;
        return createMockProcess({ stdoutLines: [], exitCode: 1 }) as any; // auth fails
      });

      const results = await detectAll();

      expect(results.claude).toEqual({
        installed: true,
        version: 'claude-code 1.0.12',
        authenticated: true,
        binaryPath: 'claude',
      });

      expect(results.codex).toEqual({
        installed: false,
        version: null,
        authenticated: false,
        binaryPath: null,
      });

      expect(results.opencode).toEqual({
        installed: true,
        version: 'opencode v0.5.0',
        authenticated: false,
        binaryPath: 'opencode',
      });
    });
  });
});
