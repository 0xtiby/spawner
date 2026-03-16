import type { DetectResult } from '../types.js';
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

  buildCommand() {
    throw new Error('claude adapter buildCommand not implemented');
  },

  parseLine(_line: string, _accumulator: SessionAccumulator) {
    throw new Error('claude adapter parseLine not implemented');
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('claude adapter classifyError not implemented');
  },
};
