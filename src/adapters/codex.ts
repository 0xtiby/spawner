import type { DetectResult, SpawnOptions } from '../types.js';
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

  buildCommand(options: SpawnOptions) {
    const isFork = options.forkSession && options.sessionId;
    const isResumeById = options.sessionId && !options.forkSession;
    const isResumeLast = !options.sessionId && options.continueSession;

    const args: string[] = [];
    let stdinInput: string | undefined = options.prompt;

    if (isFork) {
      args.push('fork', options.sessionId!);
      stdinInput = undefined;
    } else if (isResumeById) {
      args.push('exec', 'resume', options.sessionId!);
    } else if (isResumeLast) {
      args.push('exec', 'resume', '--last');
    } else {
      args.push('exec', '--json');
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.autoApprove) {
      args.push('--full-auto');
    }

    if (options.addDirs) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir);
      }
    }

    if (options.ephemeral) {
      args.push('--ephemeral');
    }

    if (options.effort) {
      args.push('-c', `model_reasoning_effort=${options.effort}`);
    }

    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return { bin: 'codex', args, stdinInput };
  },

  parseLine(_line: string, _accumulator: SessionAccumulator) {
    throw new Error('codex adapter parseLine not implemented');
  },

  classifyError(_exitCode: number, _stderr: string, _stdout: string) {
    throw new Error('codex adapter classifyError not implemented');
  },
};
