import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixturePath = resolve(__dirname, '../fixtures/models-dev-sample.json');
export const fixtureJson = readFileSync(fixturePath, 'utf8');
export const fixtureData = JSON.parse(fixtureJson);

export function mockFetchSuccess() {
  globalThis.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(fixtureJson, { status: 200 })),
  );
}

export function mockFetchFailure(error: Error = new TypeError('fetch failed')) {
  globalThis.fetch = vi.fn().mockRejectedValue(error);
}
