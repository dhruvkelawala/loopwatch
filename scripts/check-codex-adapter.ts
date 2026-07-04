/**
 * Pure unit test for the Codex Source Adapter (issue #11). No server.
 *
 * Covers the Codex mapping + the shared tail seam reuse:
 *   - the `{ type, payload, timestamp }` envelope maps to normalized events
 *     (kind/actor per envelope + payload type), no-drop payload preserved;
 *   - session identity = (codex, filename UUID), stable across records that
 *     don't repeat the session id;
 *   - head `session_meta` cwd + git (branch / repo) become per-event context;
 *   - the cursor is idempotent and resumes without re-emit (inherited core).
 *
 * Run with: pnpm codex:check
 */
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LoopwatchEventSchema, sessionKey, type LoopwatchEventInput } from '../src/events.js';
import { CodexAdapter, type IngestFn } from '../src/adapters/codex/adapter.js';
import { mapCodexRecord, sessionIdFromPath } from '../src/adapters/codex/map.js';
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

const UUID = '019d4402-394d-7421-b7b2-bc635240c227';
const ROLLOUT = `rollout-2026-03-31T14-08-09-${UUID}.jsonl`;

function rec(type: string, payload: Record<string, unknown> | null, timestamp = '2026-03-31T13:08:12.395Z') {
  return { type, payload, timestamp };
}

function jsonl(records: unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'lw-codex-'));
  const root = join(dir, 'sessions');
  const cursorDir = join(dir, 'cursors');
  const sessionDir = join(root, '2026', '03', '31');
  const rollout = join(sessionDir, ROLLOUT);
  await mkdir(sessionDir, { recursive: true });
  const ingested: LoopwatchEventInput[] = [];
  const ingest: IngestFn = async (events) => {
    ingested.push(...events);
  };
  const make = (anchor: 'start' | 'end' = 'start') => new CodexAdapter({ ingest, root, cursorDir, initialAnchor: anchor });
  return { root, cursorDir, rollout, ingested, make };
}

console.log('Codex Source Adapter — unit checks\n');

await check('sessionIdFromPath extracts the rollout UUID', () => {
  assert.equal(sessionIdFromPath(`/a/b/${ROLLOUT}`), UUID);
  assert.equal(sessionIdFromPath('rollout-no-uuid.jsonl'), 'no-uuid');
});

await check('envelope records map to normalized events: kind/actor, identity, context, no-drop', async () => {
  resetGitContextCache();
  const f = await fixture();
  const records = [
    rec('session_meta', { id: UUID, cwd: '/tmp/lw-fake-repo', cli_version: '0.117.0', git: { branch: 'fix/auth-test', repository_url: 'https://github.com/acme/acme-api.git' } }),
    rec('event_msg', { type: 'user_message', message: 'fix the failing auth test' }),
    rec('response_item', { type: 'reasoning', encrypted_content: 'gAAAA…' }),
    rec('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pwd"}', call_id: 'call_1' }),
    rec('response_item', { type: 'function_call_output', call_id: 'call_1', output: '/tmp\n' }),
    rec('event_msg', { type: 'token_count', info: null }),
    rec('event_msg', { type: 'agent_message', message: 'Done.' }),
    rec('turn_context', { cwd: '/tmp/lw-fake-repo', model: 'gpt-5.4' }),
    rec('event_msg', { type: 'exec_command_end', call_id: 'call_1', aggregated_output: 'ok' }),
    rec('some_future_envelope', { type: 'brand_new' }),
  ];
  await writeFile(f.rollout, jsonl(records));
  const summary = await f.make('start').scanOnce();

  assert.equal(summary.ingestedEvents, 10, 'every record emitted (no-drop)');
  const events = f.ingested.map((e) => LoopwatchEventSchema.parse(e));

  assert.deepEqual(
    events.map((e) => e.kind),
    ['session', 'message', 'reasoning', 'tool_call', 'tool_result', 'usage', 'message', 'session', 'tool_result', 'some_future_envelope'],
  );
  assert.deepEqual(
    events.map((e) => e.actor.type),
    ['system', 'user', 'agent', 'agent', 'tool', 'system', 'agent', 'system', 'tool', 'system'],
  );

  // Identity is the filename UUID, identical on every record.
  assert.ok(events.every((e) => e.sessionId === UUID), 'all records share the filename session id');
  assert.equal(events[0].source, 'codex');
  assert.equal(sessionKey(events[0]), `codex:${UUID}`);

  // session_meta git is source-reported context, not inferred.
  assert.equal(events[0].context?.gitBranch, 'fix/auth-test');
  assert.equal(events[0].context?.repo, 'acme-api');
  assert.equal((events[0].context as Record<string, unknown>).branchInferred, undefined, 'source-reported branch is not marked inferred');

  // No-drop: the raw envelope is preserved verbatim.
  assert.deepEqual(events[3].payload, records[3]);
});

await check('tail-from-end propagates source-reported git from the head session_meta', async () => {
  resetGitContextCache();
  const f = await fixture();
  // Seed a session_meta (carrying git) + one record, then start anchored at END
  // so the head is seeded past — the tail-mode case from the review.
  await writeFile(
    f.rollout,
    jsonl([
      rec('session_meta', { id: UUID, cwd: '/tmp/lw-fake-repo', git: { branch: 'release/next', repository_url: 'https://github.com/acme/acme-api' } }),
      rec('event_msg', { type: 'user_message', message: 'start' }),
    ]),
  );
  const adapter = f.make('end');
  assert.equal((await adapter.scanOnce()).ingestedEvents, 0, 'anchored at end → nothing on first pass');

  // A later record carries no git of its own; it must inherit the head's
  // source-reported branch/repo, NOT a working-tree inference.
  await appendFile(f.rollout, jsonl([rec('event_msg', { type: 'agent_message', message: 'done' })]));
  await adapter.scanOnce();
  const [event] = f.ingested.map((e) => LoopwatchEventSchema.parse(e));
  assert.equal(event.context?.gitBranch, 'release/next', 'inherited source-reported branch');
  assert.equal(event.context?.repo, 'acme-api', 'inherited source-reported repo');
  assert.equal((event.context as Record<string, unknown>).branchInferred, undefined, 'source-reported branch is not marked inferred');
});

await check('cursor is idempotent and resumes without re-emit across restart', async () => {
  resetGitContextCache();
  const f = await fixture();
  await writeFile(f.rollout, jsonl([rec('event_msg', { type: 'user_message', message: 'a' })]));
  const adapter = f.make('start');
  assert.equal((await adapter.scanOnce()).ingestedEvents, 1);
  assert.equal((await adapter.scanOnce()).ingestedEvents, 0, 'no new records → no re-emit');

  // Append while running → only the new record is emitted.
  await appendFile(f.rollout, jsonl([rec('event_msg', { type: 'agent_message', message: 'b' })]));
  assert.equal((await adapter.scanOnce()).ingestedEvents, 1, 'append surfaces as a new event without restart');

  // Fresh instance, same cursor dir → must not replay.
  assert.equal((await f.make('start').scanOnce()).ingestedEvents, 0, 'persisted cursor prevents re-emit after restart');
  assert.equal(f.ingested.length, 2);
});

await check('a record with no usable session id still maps to a valid event (no poison batch)', () => {
  const event = mapCodexRecord(rec('event_msg', { type: 'user_message', message: 'x' }), { fileSessionId: '', filePath: '/x.jsonl' });
  const parsed = LoopwatchEventSchema.parse(event);
  assert.ok(parsed.sessionId.length > 0, 'sessionId falls back to a non-empty sentinel');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Codex adapter checks passed.');
