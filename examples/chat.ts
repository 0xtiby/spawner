import * as readline from 'node:readline';
import { detectAll, spawn } from '../src/index.js';
import type { CliName, DetectResult } from '../src/types.js';

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

async function chatLoop(selected: AvailableCli): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.on('close', () => {
    process.exit(0);
  });

  const prompt = () => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      console.log(`You: ${trimmed}`);
      process.stdout.write('Assistant: ');
      rl.pause();

      const proc = spawn({
        cli: selected.name,
        prompt: trimmed,
        cwd: process.cwd(),
        autoApprove: true,
      });

      for await (const event of proc.events) {
        switch (event.type) {
          case 'text':
            if (event.content) {
              process.stdout.write(event.content);
            }
            break;
          case 'tool_use':
            if (event.tool?.name) {
              process.stdout.write(`\n⚙ Using ${event.tool.name}...\n`);
            }
            break;
          case 'error':
            if (event.content) {
              process.stdout.write(`\nError: ${event.content}\n`);
            }
            break;
          case 'tool_result':
          case 'system':
            // Silently skip
            break;
        }
      }

      process.stdout.write('\n');
      rl.prompt();
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

export { selectCli, main, isValidSelection, chatLoop };
export type { AvailableCli };

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
