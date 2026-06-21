/**
 * Pure unit test for the normalized event model (ADR-0004 / issue #4).
 *
 * No server, no Flue build — just the schema and the ingest helper. Proves:
 *   - the common core validates,
 *   - unknown/extra fields round-trip intact (preserved, not stripped),
 *   - nested source-native detail in `actor` and `payload` survives,
 *   - an unknown event `kind` is retained,
 *   - a malformed common core is rejected rather than silently coerced.
 *
 * Run with: pnpm events:check
 */

import assert from 'node:assert/strict';
import * as z from 'zod';

import {
  ActorSchema,
  ACTOR_TYPES,
  EVENT_KINDS,
  LoopwatchEventSchema,
  sessionKey,
  toLoopwatchEvent,
} from '../src/events.js';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, `${label} mismatch`);
}

// A record with the full common core plus a generous helping of unrecognized,
// source-native fields at every level. Every one of these must survive.
const richRecord = {
  source: 'claude',
  sessionId: 'pi_session_01HX…',
  timestamp: '2026-06-21T12:00:00.000Z',
  kind: 'tool_call',
  actor: {
    type: 'tool',
    name: 'bash',
    callId: 'call_42',
    hostNative: { pid: 1234, shell: 'zsh' }, // nested unknown detail
  },
  context: { cwd: '/Users/d/dev/loopwatch', gitBranch: 'main', sourceVersion: '2.1.170' },
  payload: {
    command: 'rg TODO',
    exitCode: 0,
    durationMs: 137,
    streamedStderr: ['warn: deprecated'], // nested unknown detail
  },
  // Unknown top-level extras an adapter might forward from a future source.
  sourceNativeFoo: { x: 1, y: [2, 3] },
  unrecognizedKindHint: 'sentinel-for-self-improvement',
  'weird.key': 7,
};

console.log('Normalized event model — unit checks\n');

check('schema validates the rich record', () => {
  const out = LoopwatchEventSchema.parse(richRecord);
  assertDeepEqual(out, richRecord, 'rich record round-trip');
});

check('unknown top-level fields are retained, not stripped', () => {
  const out = LoopwatchEventSchema.parse(richRecord);
  for (const key of ['sourceNativeFoo', 'unrecognizedKindHint', 'weird.key']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(out, key),
      true,
      `expected top-level unknown key "${key}" to survive`,
    );
    assertDeepEqual((out as Record<string, unknown>)[key], (richRecord as Record<string, unknown>)[key], key);
  }
});

check('nested source-native detail in actor and payload survives', () => {
  const out = LoopwatchEventSchema.parse(richRecord);
  assertDeepEqual((out.actor as Record<string, unknown>).hostNative, richRecord.actor.hostNative, 'actor.hostNative');
  assertDeepEqual(out.payload, richRecord.payload, 'payload');
});

check('unknown event kind is retained', () => {
  const out = LoopwatchEventSchema.parse({ ...richRecord, kind: 'something.brand.new' });
  assert.equal(out.kind, 'something.brand.new');
});

check('toLoopwatchEvent preserves unknowns and is a deep-equal round-trip', () => {
  const out = toLoopwatchEvent(richRecord);
  assertDeepEqual(out, richRecord, 'toLoopwatchEvent(richRecord)');
});

check('toLoopwatchEvent stamps timestamp when the source omits it', () => {
  const { timestamp: _omit, ...withoutTimestamp } = richRecord;
  const before = Date.now();
  const out = toLoopwatchEvent(withoutTimestamp);
  const stamped = Date.parse(out.timestamp);
  assert.equal(Number.isNaN(stamped), false, 'stamped timestamp is parseable');
  assert.ok(stamped >= before - 1000 && stamped <= Date.now() + 1000, 'stamped timestamp is ~now');
});

check('actor rejects an unknown type (core is validated, not faked)', () => {
  assert.throws(
    () => ActorSchema.parse({ type: 'plugin', name: 'x' }),
    (err: unknown) => err instanceof z.ZodError,
    'unknown actor type should be rejected',
  );
});

check('malformed common core is rejected rather than coerced', () => {
  // Missing source/sessionId, missing actor.
  assert.throws(
    () => toLoopwatchEvent({ timestamp: 'now', kind: 'message' }),
    (err: unknown) => err instanceof z.ZodError,
    'missing source + sessionId + actor should reject',
  );
});

check('source is part of the common core and required (ADR-0003)', () => {
  const { source: _omit, ...withoutSource } = richRecord;
  assert.throws(
    () => toLoopwatchEvent(withoutSource),
    (err: unknown) => err instanceof z.ZodError,
    'missing source should reject',
  );
});

check('empty identity fields are rejected (source / sessionId / kind .min(1))', () => {
  for (const bad of [
    { ...richRecord, source: '' },
    { ...richRecord, sessionId: '' },
    { ...richRecord, kind: '' },
  ]) {
    assert.throws(
      () => toLoopwatchEvent(bad),
      (err: unknown) => err instanceof z.ZodError,
      `expected empty identity field to reject: ${JSON.stringify({ source: bad.source, sessionId: bad.sessionId, kind: bad.kind })}`,
    );
  }
});

check('context (repo/branch/cwd labels) round-trips, including extras', () => {
  const out = toLoopwatchEvent(richRecord);
  assertDeepEqual(out.context, richRecord.context, 'context');
});

check('sessionKey derives the stable (source, sessionId) identity', () => {
  assert.equal(sessionKey(richRecord), 'claude:pi_session_01HX…');
  // Identity is (source, sessionId) only — repo/branch are not part of it.
  assert.equal(
    sessionKey({ source: 'claude', sessionId: 'pi_session_01HX…' }),
    sessionKey(richRecord),
    'context must not affect identity',
  );
});

check('vocabularies are the expected fixed sets', () => {
  assertDeepEqual([...ACTOR_TYPES], ['user', 'agent', 'tool', 'system'], 'ACTOR_TYPES');
  // EVENT_KINDS is documentation of the conventional set, not an enum constraint:
  assert.ok(EVENT_KINDS.includes('tool_call'));
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll normalized-event checks passed.');
