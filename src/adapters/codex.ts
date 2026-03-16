import type { DetectResult } from '../types.js';
import type { CliAdapter, SessionAccumulator } from './types.js';
import { execCommand } from '../core/detect.js';
import type { ExecResult } from '../core/detect.js';

function isExecResult(result: Awaited<ReturnType<typeof execCommand>>): result is ExecResult {
  return 'exitCode' in result;
}

export const codexAdapter: CliAdapter = {
  name: 'codex',

  async detect(): Promise<DetectResult> {
    const versionResult = await execCommand('codex', ['--version']);

    if (!isExecResult(versionResult)) {
      if (versionResult.kind === 'enoent') {
        return { installed: false, version: null, authenticated: false, binaryPath: null };
      }
      return { installed: true, version: null, authenticated: false, binaryPath: 'codex' };
    }

    const version = versionResult.stdout || null;

    const authResult = await execCommand('codex', ['login', 'status']);
    const authenticated = isExecResult(authResult) && authResult.exitCode === 0;

    return { installed: true, version, authenticated, binaryPath: 'codex' };
  },

  buildCommand() {
    throw new Error('codex adapter buildCommand not implemented');
  },

  parseLine(_line: string, _accumulator: SessionAccumulator) {
    throw new Error('codex adapter parseLine not implemented');
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('codex adapter classifyError not implemented');
  },
};
