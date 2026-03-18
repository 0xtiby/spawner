import * as readline from 'node:readline';
import { detectAll, spawn } from '../src/index.js';
import type { CliName, CliProcess, CliResult, DetectResult } from '../src/types.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const DISPLAY_NAMES: Record<CliName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

interface AvailableCli {
  name: CliName;
  displayName: string;
  result: DetectResult;
}

let activeProcess: CliProcess | null = null;

async function cleanup(): Promise<void> {
  if (activeProcess) {
    await activeProcess.interrupt();
    activeProcess = null;
  }
}

function cleanExit(code = 0): void {
  cleanup().finally(() => {
    try { process.exit(code); } catch { /* process.exit may throw in test environments */ }
  });
}

async function selectCli(): Promise<AvailableCli> {
  console.log('Detecting available CLIs...');

  const results = await detectAll();

  const available: AvailableCli[] = (Object.entries(results) as [CliName, DetectResult][])
    .filter(([, result]) => result.installed)
    .map(([name, result]) => ({
      name,
      displayName: DISPLAY_NAMES[name],
      result,
    }));

  if (available.length === 0) {
    console.error('No supported CLIs found. Install claude, codex, or opencode.');
    process.exit(1);
  }

  const printSelectionList = () => {
    console.log('\nSelect a CLI:');
    for (let i = 0; i < available.length; i++) {
      const cli = available[i];
      const version = cli.result.version ? `(v${cli.result.version})` : '(version unknown)';
      const authWarning = cli.result.authenticated ? '' : ' — not authenticated';
      console.log(`  ${i + 1}. ${cli.displayName} ${version}${authWarning}`);
    }
  };

  printSelectionList();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const choice = await new Promise<number>((resolve) => {
    rl.on('close', () => {
      process.exit(0);
    });

    const ask = () => {
      rl.question('\nEnter number: ', (answer) => {
        const num = parseInt(answer, 10);
        if (!isNaN(num) && num >= 1 && num <= available.length) {
          resolve(num);
        } else {
          console.log('Invalid selection. Try again.');
          printSelectionList();
          ask();
        }
      });
    };
    ask();
  });

  rl.close();
  return available[choice - 1];
}

function handleSlashCommand(command: string, rl: readline.Interface): boolean {
  const cmd = command.toLowerCase();

  if (cmd === '/exit') {
    console.log('Goodbye!');
    rl.close();
    void cleanExit(0);
    return true;
  }

  if (cmd === '/new') {
    console.log('Session reset not yet implemented');
    return true;
  }

  // Unknown slash command
  console.log(`Unknown command: ${command.split(/\s/)[0]}`);
  return true;
}

async function chatLoop(selected: AvailableCli): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let isStreaming = false;

  rl.on('close', () => {
    cleanExit(0);
  });

  rl.on('SIGINT', () => {
    if (isStreaming && activeProcess) {
      activeProcess.interrupt();
      return;
    }
    console.log();
    rl.close();
    cleanExit(0);
  });

  const prompt = () => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
        handleSlashCommand(trimmed, rl);
        prompt();
        return;
      }

      console.log(`${CYAN}You: ${RESET}${trimmed}`);
      process.stdout.write(`${GREEN}Assistant: ${RESET}`);
      rl.pause();

      let proc: CliProcess | null = null;

      try {
        proc = spawn({
          cli: selected.name,
          prompt: trimmed,
          cwd: process.cwd(),
          autoApprove: true,
        });
      } catch (err) {
        process.stdout.write(`\n${RED}Error: ${RESET}${err instanceof Error ? err.message : String(err)}\n`);
        isStreaming = false;
        activeProcess = null;
        prompt();
        return;
      }

      isStreaming = true;
      activeProcess = proc;

      let interrupted = false;
      let result: CliResult | null = null;

      try {
        for await (const event of proc.events) {
          switch (event.type) {
            case 'text':
              if (event.content) {
                process.stdout.write(event.content);
              }
              break;
            case 'tool_use':
              if (event.tool?.name) {
                process.stdout.write(`\n${YELLOW}⚙ Using ${event.tool.name}...${RESET}\n`);
              }
              break;
            case 'error':
              if (event.content) {
                process.stdout.write(`\n${RED}Error: ${RESET}${event.content}\n`);
              }
              break;
            case 'done':
              result = event.result ?? null;
              if (event.result?.error) {
                interrupted = true;
              }
              break;
            case 'tool_result':
            case 'system':
              // Silently skip
              break;
          }
        }
      } catch (err) {
        // Stream error — CLI crashed mid-response or binary disappeared
        process.stdout.write(`\n${RED}Error: ${RESET}${err instanceof Error ? err.message : String(err)}\n`);
      }

      // If no result from done event, await the done promise for final status
      if (!result) {
        try {
          result = await proc.done;
        } catch (r) {
          result = r as CliResult;
        }
      }

      isStreaming = false;
      activeProcess = null;

      // Check result for specific error conditions
      if (result?.error) {
        if (result.error.code === 'rate_limit') {
          const retryMsg = result.error.retryAfterMs
            ? ` (retry in ${Math.ceil(result.error.retryAfterMs / 1000)}s)`
            : '';
          console.log(`${RED}Rate limited${RESET}${retryMsg} — try again`);
        } else if (!interrupted) {
          console.log(`${RED}Error: ${RESET}${result.error.message}`);
        }
      }

      if (interrupted) {
        console.log('\nResponse interrupted.');
      } else if (!result?.error) {
        process.stdout.write('\n');
      }
      prompt();
    });
  };

  prompt();
}

async function main() {
  const selected = await selectCli();
  const versionSuffix = selected.result.version ? ` v${selected.result.version}` : '';
  console.log(`\nUsing ${selected.displayName}${versionSuffix} — type a message to begin, /exit to quit`);

  await chatLoop(selected);
}

function isValidSelection(input: string, maxOptions: number): boolean {
  const num = parseInt(input, 10);
  return !isNaN(num) && num >= 1 && num <= maxOptions;
}

export { selectCli, main, isValidSelection, handleSlashCommand, chatLoop, cleanup, cleanExit, CYAN, GREEN, YELLOW, RED, RESET };
export type { AvailableCli };

const isMainModule = process.argv[1]?.endsWith('chat.ts') || process.argv[1]?.endsWith('chat.js');

if (isMainModule) {
  process.on('SIGTERM', () => {
    cleanExit(0);
  });

  main().catch((err) => {
    console.error(err);
    cleanExit(1);
  });
}
