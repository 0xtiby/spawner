import type { DetectResult } from '../types.js';
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

  buildCommand() {
    throw new Error('opencode adapter buildCommand not implemented');
  },

  parseLine(_line: string, _accumulator: SessionAccumulator) {
    throw new Error('opencode adapter parseLine not implemented');
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('opencode adapter classifyError not implemented');
  },
};
