import type { DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

export const claudeAdapter: CliAdapter = {
  name: 'claude',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('claude', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      // timeout or other error — binary exists but didn't respond
      return { installed: true, version: null, authenticated: false, binaryPath: 'claude' };
    }

    const version = versionResult.stdout || null;

    const authResult = await execCommand('claude', ['auth', 'status']);
    const authenticated = isExecResult(authResult) && authResult.exitCode === 0;

    return { installed: true, version, authenticated, binaryPath: 'claude' };
  },

  buildCommand(options: SpawnOptions) {
    const args: string[] = ['--print', '--output-format', 'stream-json', '--verbose'];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Session logic: sessionId takes precedence over continueSession
    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    } else if (options.continueSession) {
      args.push('--continue');
    }

    // forkSession is additive — only applies when sessionId or continueSession is set
    if (options.forkSession && (options.sessionId || options.continueSession)) {
      args.push('--fork-session');
    }

    if (options.effort) {
      args.push('--effort', options.effort);
    }

    if (options.autoApprove) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.addDirs) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir);
      }
    }

    if (options.ephemeral) {
      args.push('--no-session-persistence');
    }

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return { bin: 'claude', args, stdinInput: options.prompt };
  },

  parseLine(_line: string, _accumulator: SessionAccumulator) {
    throw new Error('claude adapter parseLine not implemented');
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('claude adapter classifyError not implemented');
  },
};
