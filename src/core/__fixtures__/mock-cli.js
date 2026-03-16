#!/usr/bin/env node
// Mock CLI script for spawn() integration tests.
// Reads stdin, outputs Claude-format JSONL to stdout, exits with configurable code.
//
// Usage: node mock-cli.js [--exit-code N] [--delay-ms N] [--ignore-sigterm]
//
// Stdin is read and echoed as a text event in Claude stream-json format.

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

const exitCode = Number(flag('--exit-code') ?? 0);
const delayMs = Number(flag('--delay-ms') ?? 0);
const ignoreSigterm = args.includes('--ignore-sigterm');

if (ignoreSigterm) {
  process.on('SIGTERM', () => {});
}

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', async () => {
  // System event with session info
  writeLine({
    type: 'system',
    session_id: 'mock-session-001',
    model: 'claude-sonnet-4-20250514',
  });

  // Text event with stdin content
  writeLine({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: stdin || 'no input' }],
    },
  });

  // Result event with usage
  writeLine({
    type: 'result',
    session_id: 'mock-session-001',
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 10, output_tokens: 20 },
    cost_usd: 0.001,
  });

  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  process.exit(exitCode);
});
