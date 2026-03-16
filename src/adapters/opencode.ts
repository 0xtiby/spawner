import type { DetectResult, SpawnOptions } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('opencode', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      return { installed: true, version: null, authenticated: false, binaryPath: 'opencode' };
    }

    const version = versionResult.stdout || null;

    const authResult = await execCommand('opencode', ['auth', 'list']);
    const authenticated = isExecResult(authResult) && authResult.stdout.trim().length > 0;

    return { installed: true, version, authenticated, binaryPath: 'opencode' };
  },

  buildCommand(options: SpawnOptions) {
    const args: string[] = ['run', '--format', 'json'];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Session logic: sessionId takes precedence over continueSession
    if (options.sessionId) {
      args.push('--session', options.sessionId);
    } else if (options.continueSession) {
      args.push('--continue');
    }

    // forkSession is additive — only applies when sessionId or continueSession is set
    if (options.forkSession && (options.sessionId || options.continueSession)) {
      args.push('--fork');
    }

    // Unsupported options silently ignored: autoApprove, addDirs, ephemeral, effort

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return { bin: 'opencode', args, stdinInput: options.prompt };
  },

  parseLine(_line: string, _accumulator: SessionAccumulator) {
    throw new Error('opencode adapter parseLine not implemented');
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('opencode adapter classifyError not implemented');
  },
};
