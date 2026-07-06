/**
 * Pure unit test for the Pi Source Adapter (issue #11).
 *
 * Covers the Pi mapping + the issue's git-inference acceptance criterion:
 *   - typed records map to normalized events (kind/actor per type + role),
 *     assistant tool turns → tool_call, no-drop payload preserved (incl. the
 *     `usage.cost.total` Pi alone reports);
 *   - session identity = (pi, filename UUID), not the per-record message id;
 *   - a Pi session (no in-transcript branch) still gets repo + branch context
 *     inferred from git, marked `branchInferred`;
 *   - the cursor is idempotent and resumes without re-emit (inherited core).
 *
 * Run with: pnpm pi:check
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LoopwatchEventSchema, sessionKey, type LoopwatchEventInput } from '../src/events.js';
import { PiAdapter, type IngestFn } from '../src/adapters/pi/adapter.js';
import { mapPiRecord, sessionIdFromPath } from '../src/adapters/pi/map.js';
import { resetGitContextCache } from '../src/adapters/core/git-context.js';

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

const UUID = '019efb4d-0ae5-7d31-8c40-8f3d27621679';
const FILE = `2026-06-24T20-23-10-821Z_${UUID}.jsonl`;

function jsonl(records: unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** A Pi session fixture whose head `session` cwd points at a real git repo. */
async function fixture(sessionCwd: string) {
  const dir = await mkdtemp(join(tmpdir(), 'lw-pi-'));
  const root = join(dir, 'sessions');
  const cursorDir = join(dir, 'cursors');
  const slugDir = join(root, '--Users-d-dev-loopwatch--');
  const transcript = join(slugDir, FILE);
  await mkdir(slugDir, { recursive: true });
  const ingested: LoopwatchEventInput[] = [];
  const ingest: IngestFn = async (events) => {
    ingested.push(...events);
  };
  const make = (anchor: 'start' | 'end' = 'start') => new PiAdapter({ ingest, root, cursorDir, initialAnchor: anchor });
  return { root, cursorDir, transcript, sessionCwd, ingested, make };
}

console.log('Pi Source Adapter — unit checks\n');

await check('sessionIdFromPath extracts the trailing UUID, not the message id', () => {
  assert.equal(sessionIdFromPath(`/a/b/${FILE}`), UUID);
  assert.equal(sessionIdFromPath('2026-06-24T20-23-10-821Z_short.jsonl'), 'short');
});

await check('typed records map to normalized events: kind/actor, identity, no-drop cost', async () => {
  resetGitContextCache();
  const f = await fixture(process.cwd());
  const records = [
    { type: 'session', version: 3, id: UUID, timestamp: '2026-06-24T20:23:10.821Z', cwd: process.cwd() },
    { type: 'model_change', id: 'c99', timestamp: '2026-06-24T20:23:14.194Z', provider: 'openai-codex', modelId: 'gpt-5.5' },
    { type: 'message', id: 'm-user', timestamp: '2026-06-24T20:23:20.078Z', message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] } },
    {
      type: 'message',
      id: 'm-asst',
      timestamp: '2026-06-24T20:23:27.872Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }], usage: { totalTokens: 30766, cost: { total: 0.0123 } } },
    },
    {
      type: 'message',
      id: 'm-tool',
      timestamp: '2026-06-24T20:23:28.000Z',
      message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } }] },
    },
    { type: 'message', id: 'm-res', timestamp: '2026-06-24T20:23:29.000Z', message: { role: 'toolResult', toolCallId: 'call_1', content: [{ type: 'text', text: 'a b c' }] } },
    { type: 'message', id: 'm-bash', timestamp: '2026-06-24T20:23:30.000Z', message: { role: 'bashExecution', command: 'zed .', output: '' } },
    { type: 'custom', customType: 'slate', id: 'm-cust', timestamp: '2026-06-24T20:23:31.964Z', data: { items: [] } },
    { type: 'some_future_type', id: 'm-future', timestamp: '2026-06-24T20:23:32.000Z' },
  ];
  await writeFile(f.transcript, jsonl(records));
  const summary = await f.make('start').scanOnce();

  assert.equal(summary.ingestedEvents, 9, 'every record emitted (no-drop)');
  const events = f.ingested.map((e) => LoopwatchEventSchema.parse(e));

  assert.deepEqual(
    events.map((e) => e.kind),
    ['session', 'diagnostic', 'message', 'message', 'tool_call', 'tool_result', 'tool_result', 'diagnostic', 'some_future_type'],
  );
  assert.deepEqual(
    events.map((e) => e.actor.type),
    ['system', 'system', 'user', 'agent', 'agent', 'tool', 'tool', 'system', 'system'],
  );

  // Identity is the filename UUID, identical on every record (not the message id).
  assert.ok(events.every((e) => e.sessionId === UUID), 'all records share the filename session id');
  assert.equal(events[0].source, 'pi');
  assert.equal(sessionKey(events[0]), `pi:${UUID}`);

  // No-drop: the assistant message's usage.cost survives verbatim for the UI.
  const assistant = events[3];
  const payload = assistant.payload as { message?: { usage?: { cost?: { total?: number } } } };
  assert.equal(payload.message?.usage?.cost?.total, 0.0123, 'cost is preserved (Pi-only capability)');
});

/** A throwaway git repo on a deterministic named branch (robust under detached-HEAD CI). */
async function tempGitRepo(branch: string): Promise<{ root: string; repo: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'lw-pi-repo-'));
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  run('init', '-q');
  run('checkout', '-q', '-b', branch);
  run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  // git resolves the realpath (macOS /var → /private/var), so derive repo from it.
  const toplevel = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel']).toString().trim();
  return { root: dir, repo: toplevel.split('/').filter(Boolean).at(-1) ?? 'repo' };
}

await check('a Pi session (no in-transcript branch) gets repo + branch inferred from git', async () => {
  resetGitContextCache();
  const expectedBranch = 'feat/pi-inference';
  const { root: repoRoot, repo: expectedRepo } = await tempGitRepo(expectedBranch);

  const f = await fixture(repoRoot);
  await writeFile(
    f.transcript,
    jsonl([
      { type: 'session', id: UUID, timestamp: '2026-06-24T20:23:10.821Z', cwd: repoRoot },
      { type: 'message', id: 'm1', timestamp: '2026-06-24T20:23:20.000Z', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
    ]),
  );
  await f.make('start').scanOnce();

  const events = f.ingested.map((e) => LoopwatchEventSchema.parse(e));
  // Every event in the session gets the inferred repo/branch (propagated from cwd).
  for (const event of events) {
    assert.equal(event.context?.repo, expectedRepo, 'repo inferred from git toplevel');
    assert.equal(event.context?.gitBranch, expectedBranch, 'branch inferred from git HEAD');
    assert.equal((event.context as Record<string, unknown>).branchInferred, true, 'inferred branch is marked honest');
  }
});

await check('cursor is idempotent and resumes without re-emit across restart', async () => {
  resetGitContextCache();
  const f = await fixture(process.cwd());
  await writeFile(f.transcript, jsonl([{ type: 'message', id: 'm1', timestamp: '2026-06-24T20:23:20.000Z', message: { role: 'user', content: [{ type: 'text', text: 'a' }] } }]));
  const adapter = f.make('start');
  assert.equal((await adapter.scanOnce()).ingestedEvents, 1);
  assert.equal((await adapter.scanOnce()).ingestedEvents, 0, 'no new records → no re-emit');

  await appendFile(f.transcript, jsonl([{ type: 'message', id: 'm2', timestamp: '2026-06-24T20:23:27.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] } }]));
  assert.equal((await adapter.scanOnce()).ingestedEvents, 1, 'append surfaces as a new event without restart');

  assert.equal((await f.make('start').scanOnce()).ingestedEvents, 0, 'persisted cursor prevents re-emit after restart');
});

await check('a record with no usable session id still maps to a valid event (no poison batch)', () => {
  const event = mapPiRecord({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }, { fileSessionId: '', filePath: '/x.jsonl' });
  const parsed = LoopwatchEventSchema.parse(event);
  assert.ok(parsed.sessionId.length > 0, 'sessionId falls back to a non-empty sentinel');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Pi adapter checks passed.');
