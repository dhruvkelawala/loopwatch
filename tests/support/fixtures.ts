import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const testsRoot = join(repoRoot, 'tests');
export const fixturesRoot = join(testsRoot, 'fixtures');

export function fixturePath(...segments: string[]): string {
  return join(fixturesRoot, ...segments);
}

export async function readTextFixture(...segments: string[]): Promise<string> {
  return readFile(fixturePath(...segments), 'utf8');
}

export async function readJsonFixture<T = unknown>(...segments: string[]): Promise<T> {
  return JSON.parse(await readTextFixture(...segments)) as T;
}

export async function readJsonlFixture(...segments: string[]): Promise<unknown[]> {
  const text = await readTextFixture(...segments);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}
