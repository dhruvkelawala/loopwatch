/**
 * Pure unit test for the Claude Source Adapter (issue #5). No server.
 *
 * Covers the adapter's acceptance criteria at the scan level:
 *   - records map to normalized events (identity, context, kind/actor, no-drop);
 *   - session identity = (claude, sessionId); cwd/gitBranch are context labels;
 *   - the cursor is idempotent: a re-scan with no change emits nothing;
 *   - new appends to an active transcript appear as new events (no restart);
 *   - the cursor survives a restart (fresh adapter resumes, no re-emit);
 *   - a partial trailing line is held until complete;
 *   - liveness transitions active → idle → ended on thresholds.
 *
 * Run with: pnpm adapter:check
 */
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LoopwatchEventSchema, sessionKey, type LoopwatchEventInput } from '../src/events.js';
import { ClaudeAdapter, type IngestFn } from '../src/adapters/claude/adapter.js';
import { LivenessTracker } from '../src/adapters/claude/liveness.js';
import { mapClaudeRecord } from '../src/adapters/claude/map.js';
import { loadCursor, saveCursor } from '../src/adapters/claude/cursor.js';
import { PARSER_VERSION } from '../src/adapters/claude/types.js';

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

const SID = '906a73eb-d1d1-4d1d-ba18-88c95b3abae3';
let uuidN = 0;
function rec(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: SID,
    uuid: `uuid-${++uuidN}`,
    timestamp: '2026-06-21T12:00:00.000Z',
    cwd: '/Users/d/dev/loopwatch',
    gitBranch: 'feature/x',
    version: '2.1.170',
    ...extra,
  };
}

function jsonl(records: Record<string, unknown>[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** A fresh temp fixture: a transcript root + a cursor dir + an in-memory ingest sink. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'lw-claude-'));
  const root = join(dir, 'projects');
  const cursorDir = join(dir, 'cursors');
  const projectDir = join(root, '-Users-d-dev-loopwatch');
  const transcript = join(projectDir, `${SID}.jsonl`);
  await mkdir(projectDir, { recursive: true });
  const ingested: LoopwatchEventInput[] = [];
  const ingest: IngestFn = async (events) => {
    ingested.push(...events);
  };
  const make = (anchor: 'start' | 'end' = 'start') =>
    new ClaudeAdapter({ ingest, root, cursorDir, initialAnchor: anchor });
  return { root, cursorDir, transcript, ingested, ingest, make };
}

console.log('Claude Source Adapter — unit checks\n');

await check('records map to normalized events: identity, context, kind/actor, no-drop', async () => {
  const f = await fixture();
  const records = [
    rec({ type: 'user', message: { role: 'user', content: 'hello' } }),
    rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } }),
    rec({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1' }] } }),
    rec({ type: 'system', subtype: 'hook', content: 'hook fired' }),
    rec({ type: 'ai-title', aiTitle: 'My session' }), // unknown native type
  ];
  await writeFile(f.transcript, jsonl(records));
  const summary = await f.make('start').scanOnce();

  assert.equal(summary.ingestedEvents, 6, 'all six records emitted');
  // Every emitted event is a valid normalized event.
  const events = f.ingested.map((e) => LoopwatchEventSchema.parse(e));

  assert.deepEqual(events.map((e) => e.kind), ['message', 'message', 'tool_call', 'tool_result', 'system', 'ai-title']);
  assert.deepEqual(events.map((e) => e.actor.type), ['user', 'agent', 'agent', 'tool', 'system', 'system']);

  // Identity + context on the first event.
  const first = events[0];
  assert.equal(first.source, 'claude');
  assert.equal(first.sessionId, SID);
  assert.equal(sessionKey(first), `claude:${SID}`);
  assert.equal(first.context?.cwd, '/Users/d/dev/loopwatch');
  assert.equal(first.context?.gitBranch, 'feature/x');
  assert.equal((first.context as Record<string, unknown>).sourceVersion, '2.1.170');

  // No-drop: the full raw record is preserved verbatim as payload.
  assert.deepEqual(first.payload, records[0], 'payload preserves the raw record');
  // The unknown record type round-trips as the kind.
  assert.equal(events[5].kind, 'ai-title');
});

await check('cursor is idempotent: a re-scan with no change emits nothing', async () => {
  const f = await fixture();
  await writeFile(f.transcript, jsonl([rec({ type: 'user', message: { role: 'user', content: 'a' } })]));
  const adapter = f.make('start');
  const first = await adapter.scanOnce();
  assert.equal(first.ingestedEvents, 1);
  const second = await adapter.scanOnce();
  assert.equal(second.ingestedEvents, 0, 'no new records → no re-emit');
  assert.equal(f.ingested.length, 1, 'total ingested stays at 1');
});

await check('new appends appear as new events without restart', async () => {
  const f = await fixture();
  await writeFile(f.transcript, jsonl([rec({ type: 'user', message: { role: 'user', content: 'a' } })]));
  const adapter = f.make('start');
  await adapter.scanOnce();
  assert.equal(f.ingested.length, 1);

  // Append while the same adapter instance keeps running.
  await appendFile(f.transcript, jsonl([rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] } })]));
  const after = await adapter.scanOnce();
  assert.equal(after.ingestedEvents, 1, 'only the appended record is emitted');
  assert.equal(f.ingested.length, 2);
  assert.equal(LoopwatchEventSchema.parse(f.ingested[1]).kind, 'message');
});

await check('cursor survives restart: a fresh adapter resumes without re-emit', async () => {
  const f = await fixture();
  await writeFile(f.transcript, jsonl([rec({ type: 'user', message: { role: 'user', content: 'a' } }), rec({ type: 'system', content: 's' })]));
  await f.make('start').scanOnce();
  assert.equal(f.ingested.length, 2);

  // New ClaudeAdapter instance, same cursorDir/root → must not replay.
  const restarted = f.make('start');
  const summary = await restarted.scanOnce();
  assert.equal(summary.ingestedEvents, 0, 'persisted cursor prevents re-emit after restart');
  assert.equal(f.ingested.length, 2);
});

await check('a partial trailing line is held until complete', async () => {
  const f = await fixture();
  const a = rec({ type: 'user', message: { role: 'user', content: 'a' } });
  const b = rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] } });
  // One complete line + a partial line (no trailing newline).
  await writeFile(f.transcript, JSON.stringify(a) + '\n' + JSON.stringify(b).slice(0, 20));
  const adapter = f.make('start');
  const first = await adapter.scanOnce();
  assert.equal(first.ingestedEvents, 1, 'only the complete record is emitted');

  // Complete the partial line.
  await appendFile(f.transcript, JSON.stringify(b).slice(20) + '\n');
  const second = await adapter.scanOnce();
  assert.equal(second.ingestedEvents, 1, 'the now-complete record is emitted');
  assert.equal(f.ingested.length, 2);
});

await check('rotation during a partial line re-anchors (no skipped leading records)', async () => {
  const f = await fixture();
  // Seed a fat first record so the committed cursor offset is large.
  await writeFile(f.transcript, jsonl([rec({ type: 'user', message: { role: 'user', content: 'x'.repeat(800) } })]));
  const adapter = f.make('start');
  await adapter.scanOnce();
  assert.equal(f.ingested.length, 1);

  // Rotate: a brand-new file at the same path (new inode) holding only a
  // PARTIAL line (no trailing newline) — the bytesRead === 0 + inode-change case.
  const rotated = rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'new session' }] } });
  const line = JSON.stringify(rotated);
  await rm(f.transcript);
  await writeFile(f.transcript, line.slice(0, 15));
  const partial = await adapter.scanOnce();
  assert.equal(partial.ingestedEvents, 0, 'partial line on the rotated file yields nothing yet');

  // Complete the rotated file's first line (smaller than the old offset).
  await appendFile(f.transcript, line.slice(15) + '\n');
  const completed = await adapter.scanOnce();
  assert.equal(completed.ingestedEvents, 1, "rotated file's leading record is read, not skipped");
  assert.equal(f.ingested.length, 2);
});

await check('cursor persists for very deep project paths (no filename-length limit)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lw-claude-deep-'));
  // A path long enough that base64url(path) would blow past the 255-byte
  // filename limit (ENAMETOOLONG); sha256 keeps it fixed-length.
  const longPath = join(dir, `-Users-d-dev-${'nested-'.repeat(40)}repo`, `${'a'.repeat(60)}.jsonl`);
  const cursor = { path: longPath, fileId: '123', byteOffset: 42, lastUuid: 'u1', parserVersion: PARSER_VERSION };
  await saveCursor(dir, cursor); // would throw ENAMETOOLONG before the hash fix
  const load = await loadCursor(dir, longPath);
  assert.equal(load.status, 'loaded', 'deep-path cursor round-trips');
  if (load.status === 'loaded') assert.equal(load.cursor.byteOffset, 42);
});

await check('a parser-version bump re-reads from start even under anchor=end (no skip)', async () => {
  const f = await fixture();
  await writeFile(
    f.transcript,
    jsonl([
      rec({ type: 'user', message: { role: 'user', content: 'a' } }),
      rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] } }),
    ]),
  );
  // Simulate a cursor written by an OLDER parser version, anchored at end.
  const { size } = await stat(f.transcript);
  await saveCursor(f.cursorDir, {
    path: f.transcript,
    fileId: null,
    byteOffset: size,
    lastUuid: null,
    parserVersion: PARSER_VERSION - 1,
  });
  // Under anchor 'end' a brand-new cursor would skip to end; an INVALIDATED
  // cursor must instead re-read from the start so the new mapping re-emits.
  const summary = await f.make('end').scanOnce();
  assert.equal(summary.ingestedEvents, 2, 'invalidated cursor re-reads from start, not end');
});

await check('a record with no usable session id still maps to a valid event (no poison batch)', async () => {
  // Worst case: record omits sessionId AND the filename yields no session id.
  const event = mapClaudeRecord({ type: 'user', message: { role: 'user', content: 'x' } }, { fileSessionId: '' });
  const parsed = LoopwatchEventSchema.parse(event); // must not throw — would otherwise wedge the batch
  assert.ok(parsed.sessionId.length > 0, 'sessionId falls back to a non-empty sentinel');
});

await check('a failing transcript is isolated: other transcripts still ingest', async () => {
  // Two transcripts under one root; ingest throws only for session BAD.
  const dir = await mkdtemp(join(tmpdir(), 'lw-claude-iso-'));
  const root = join(dir, 'projects');
  const goodDir = join(root, '-proj-good');
  const badDir = join(root, '-proj-bad');
  await mkdir(goodDir, { recursive: true });
  await mkdir(badDir, { recursive: true });
  // Sort order puts -proj-bad before -proj-good, so the failure comes first.
  const badSid = 'bad-session';
  const goodSid = 'good-session';
  await writeFile(join(badDir, `${badSid}.jsonl`), jsonl([{ sessionId: badSid, uuid: 'b1', type: 'user', message: { role: 'user', content: 'x' } }]));
  await writeFile(join(goodDir, `${goodSid}.jsonl`), jsonl([{ sessionId: goodSid, uuid: 'g1', type: 'user', message: { role: 'user', content: 'y' } }]));

  const seen: string[] = [];
  const ingest: IngestFn = async (events) => {
    if (events.some((e) => e.sessionId === badSid)) throw new Error('simulated ingest failure');
    seen.push(...events.map((e) => e.sessionId));
  };
  const adapter = new ClaudeAdapter({ ingest, root, cursorDir: join(dir, 'cursors'), initialAnchor: 'start' });

  // Must not throw despite the bad transcript failing first.
  const summary = await adapter.scanOnce();
  assert.equal(summary.ingestedEvents, 1, 'the good transcript still ingested');
  assert.deepEqual(seen, [goodSid], 'only the good session committed');

  // The bad transcript's cursor was not advanced → it retries next pass.
  const retry = await adapter.scanOnce();
  assert.equal(retry.ingestedEvents, 0, 'good session already committed, not re-emitted');
});

await check('liveness transitions active → idle → ended on thresholds', async () => {
  const tracker = new LivenessTracker({ idleAfterMs: 1000, endedAfterMs: 5000 });
  const id = { source: 'claude', sessionId: SID };
  const t0 = 1_000_000;
  tracker.observe(id, t0);

  // At t0 the session starts active; polling at t0 yields no transition.
  assert.deepEqual(tracker.poll(t0), [], 'no transition at t0');
  assert.equal(tracker.state(id), 'active');

  const toIdle = tracker.poll(t0 + 1500);
  assert.deepEqual(toIdle.map((t) => `${t.from}->${t.to}`), ['active->idle']);

  const toEnded = tracker.poll(t0 + 6000);
  assert.deepEqual(toEnded.map((t) => `${t.from}->${t.to}`), ['idle->ended']);

  // A fresh append revives the session.
  tracker.observe(id, t0 + 7000);
  const revived = tracker.poll(t0 + 7000);
  assert.deepEqual(revived.map((t) => `${t.from}->${t.to}`), ['ended->active']);

  // An explicitly ended (archived) session also revives on a fresh append.
  const id2 = { source: 'claude', sessionId: 'explicit-end' };
  tracker.observe(id2, t0);
  tracker.markEnded(id2);
  assert.deepEqual(tracker.poll(t0).map((t) => `${t.from}->${t.to}`), ['active->ended'], 'markEnded → ended');
  tracker.observe(id2, t0 + 100);
  assert.deepEqual(tracker.poll(t0 + 100).map((t) => `${t.from}->${t.to}`), ['ended->active'], 'append revives an ended session');
});

await check('long-dead sessions are evicted to bound memory', () => {
  const tracker = new LivenessTracker({ idleAfterMs: 1000, endedAfterMs: 5000 });
  const id = { source: 'claude', sessionId: 'evict-me' };
  const t0 = 2_000_000;
  tracker.observe(id, t0);
  tracker.poll(t0 + 5000); // → ended
  assert.equal(tracker.state(id), 'ended');
  // Well past 2× endedAfterMs with no new append → evicted.
  tracker.poll(t0 + 5000 + 5000 * 2);
  assert.equal(tracker.state(id), undefined, 'evicted after long inactivity');
  // A later append re-creates it as a fresh active session.
  tracker.observe(id, t0 + 100_000);
  assert.equal(tracker.state(id), 'active');

  // An explicit end on a never-observed session is retained, not instantly evicted.
  const tracker2 = new LivenessTracker({ idleAfterMs: 1000, endedAfterMs: 5000 });
  const idM = { source: 'claude', sessionId: 'archived-unseen' };
  const tm = 3_000_000;
  tracker2.markEnded(idM, tm);
  assert.deepEqual(tracker2.poll(tm).map((t) => `${t.from}->${t.to}`), ['active->ended'], 'unobserved markEnded → ended');
  assert.equal(tracker2.state(idM), 'ended', 'explicitly-ended session is retained');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Claude adapter checks passed.');
