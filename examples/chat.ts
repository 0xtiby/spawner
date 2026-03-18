import * as readline from 'node:readline';
import { detectAll } from '../src/index.js';
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

  console.log('\nSelect a CLI:');
  for (let i = 0; i < available.length; i++) {
    const cli = available[i];
    const version = cli.result.version ? `(v${cli.result.version})` : '(version unknown)';
    const authWarning = cli.result.authenticated ? '' : ' — not authenticated';
    console.log(`  ${i + 1}. ${cli.displayName} ${version}${authWarning}`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const choice = await new Promise<number>((resolve) => {
    const ask = () => {
      rl.question('\nEnter number: ', (answer) => {
        const num = parseInt(answer, 10);
        if (num >= 1 && num <= available.length) {
          resolve(num);
        } else {
          console.log('Invalid selection. Try again.');
          ask();
        }
      });
    };
    ask();
  });

  rl.close();
  return available[choice - 1];
}

async function main() {
  const selected = await selectCli();
  const versionSuffix = selected.result.version ? ` v${selected.result.version}` : '';
  console.log(`\nUsing ${selected.displayName}${versionSuffix} — type a message to begin, /exit to quit`);

  // Export selected CLI name for spec 02 to consume
  return selected;
}

export { selectCli, main };
export type { AvailableCli };

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
