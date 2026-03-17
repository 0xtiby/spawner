#!/usr/bin/env npx tsx
/**
 * E2E test script — validates spawner against a real installed CLI.
 *
 * Usage: npx tsx scripts/test-e2e.ts [claude|codex|opencode]
 *
 * Requires the target CLI to be installed and authenticated.
 */

import { detect, spawn } from '../src/index.js';
import type { CliName, CliEvent } from '../src/index.js';

const cli: CliName = (process.argv[2] as CliName) || 'claude';
const VALID_CLIS: CliName[] = ['claude', 'codex', 'opencode'];

if (!VALID_CLIS.includes(cli)) {
  console.error(`Unknown CLI: ${cli}. Must be one of: ${VALID_CLIS.join(', ')}`);
  process.exit(1);
}

async function main() {
  // Step 1: Detect CLI availability
  console.log(`\n--- Detecting ${cli} ---`);
  const detectResult = await detect(cli);
  console.log('Detect result:', detectResult);

  if (!detectResult.installed) {
    console.error(`${cli} is not installed. Skipping E2E test.`);
    process.exit(1);
  }

  if (!detectResult.authenticated) {
    console.error(`${cli} is not authenticated. Skipping E2E test.`);
    process.exit(1);
  }

  // Step 2: Spawn with a prompt that triggers tool use
  console.log(`\n--- Spawning ${cli} (first run) ---`);
  const proc = spawn({
    cli,
    prompt: 'List the files in the current directory using a tool, then ask me what file I want to read.',
    cwd: process.cwd(),
    autoApprove: true,
  });

  console.log(`PID: ${proc.pid}`);

  // Step 3: Stream events in real-time
  for await (const event of proc.events) {
    printEvent(event);
  }

  const result = await proc.done;

  // Step 4: Capture session ID
  console.log('\n--- First run result ---');
  console.log('Exit code:', result.exitCode);
  console.log('Session ID:', result.sessionId);
  console.log('Model:', result.model);
  console.log('Usage:', result.usage);
  console.log('Duration:', result.durationMs, 'ms');

  if (result.error) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.sessionId) {
    console.warn('No session ID captured — skipping resume test.');
    console.log('\nTest complete');
    return;
  }

  // Step 5: Wait 2 seconds before resume
  console.log('\n--- Waiting 2s before resume ---');
  await sleep(2000);

  // Step 6: Resume with session ID
  console.log(`\n--- Resuming session ${result.sessionId} ---`);
  const resumeProc = spawn({
    cli,
    prompt: 'Read the package.json file.',
    cwd: process.cwd(),
    sessionId: result.sessionId,
    continueSession: true,
    autoApprove: true,
  });

  console.log(`Resume PID: ${resumeProc.pid}`);

  for await (const event of resumeProc.events) {
    printEvent(event);
  }

  const resumeResult = await resumeProc.done;

  console.log('\n--- Resume result ---');
  console.log('Exit code:', resumeResult.exitCode);
  console.log('Session ID:', resumeResult.sessionId);
  console.log('Usage:', resumeResult.usage);
  console.log('Duration:', resumeResult.durationMs, 'ms');

  if (resumeResult.error) {
    console.error('Error:', resumeResult.error);
    process.exit(1);
  }

  console.log('\nTest complete');
}

function printEvent(event: CliEvent) {
  const prefix = `[${event.type}]`;
  switch (event.type) {
    case 'text':
      process.stdout.write(`${prefix} ${event.content ?? ''}\n`);
      break;
    case 'tool_use':
      console.log(`${prefix} tool=${event.tool?.name} input=${JSON.stringify(event.tool?.input)}`);
      break;
    case 'tool_result':
      console.log(`${prefix} tool=${event.toolResult?.name} output=${(event.toolResult?.output ?? '').slice(0, 200)}`);
      break;
    case 'error':
      console.log(`${prefix} ${event.content}`);
      break;
    case 'system':
      console.log(`${prefix} ${event.content}`);
      break;
    case 'done':
      console.log(`${prefix} session complete`);
      break;
    default:
      console.log(`${prefix} ${event.raw}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
