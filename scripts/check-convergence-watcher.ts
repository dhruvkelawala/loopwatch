import assert from 'node:assert/strict';
import {
  buildConvergenceSnapshot,
  createConvergenceWatcherRegistry,
  type ConvergenceConfig,
  type ConvergenceSnapshot,
  type ConvergenceStatus,
  type ConvergenceSignal,
} from '../src/convergence.js';
import type { LoopwatchEvent } from '../src/events.js';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const baseMs = Date.parse('2026-07-04T12:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

type EventInput = {
  id: string;
  atMs: number;
  kind: string;
  actor: LoopwatchEvent['actor'];
  payload?: unknown;
  source?: string;
  sessionId?: string;
};

function event(input: EventInput): LoopwatchEvent {
  return {
    source: input.source ?? 'claude',
    sessionId: input.sessionId ?? 'slice-6-session',
    timestamp: iso(input.atMs),
    kind: input.kind,
    actor: input.actor,
    payload: input.payload,
  };
}

function userMessage(id: string, atMs: number, text: string): LoopwatchEvent {
  return event({ id, atMs, kind: 'message', actor: { type: 'user' }, payload: { id, text } });
}

function agentMessage(id: string, atMs: number, text: string): LoopwatchEvent {
  return event({ id, atMs, kind: 'message', actor: { type: 'agent' }, payload: { id, text } });
}

function toolCall(id: string, atMs: number, toolName: string, command: string): LoopwatchEvent {
  return event({ id, atMs, kind: 'tool_call', actor: { type: 'agent', name: toolName }, payload: { id, toolName, command } });
}

function validationResult(id: string, atMs: number, command: string, exitCode: number, output: string): LoopwatchEvent {
  return event({
    id,
    atMs,
    kind: 'tool_result',
    actor: { type: 'tool', name: 'pnpm' },
    payload: { id, command, exitCode, output },
  });
}

function usage(id: string, atMs: number, totalTokens: number): LoopwatchEvent {
  return event({ id, atMs, kind: 'usage', actor: { type: 'system' }, payload: { id, usage: { totalTokens } } });
}

function snapshot(events: LoopwatchEvent[], config: ConvergenceConfig = {}): ConvergenceSnapshot {
  return buildConvergenceSnapshot(events, {
    nowMs: baseMs + 12_000,
    minJudgeIntervalMs: 60_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
    ...config,
    registry: config.registry ?? createConvergenceWatcherRegistry(),
  });
}

function onlySession(result: ConvergenceSnapshot) {
  assert.equal(result.sessions.length, 1, 'expected exactly one watched session');
  const [session] = result.sessions;
  return session;
}

function evidenceSignals(result: ConvergenceSnapshot): ConvergenceSignal[] {
  return onlySession(result).evidence.map((item) => item.signal);
}

function assertStatusWithEvidence(result: ConvergenceSnapshot, status: ConvergenceStatus, signal: ConvergenceSignal, eventId: string) {
  const session = onlySession(result);
  assert.equal(session.status, status);
  assert.equal(session.evidence[0]?.signal, signal);
  assert.equal(session.evidence[0]?.eventId, eventId);
  if (status === 'intervention') assert.ok(session.evidence[0]?.recommendedAction, `${signal} intervention carries a recommended action`);
  assert.equal(session.judge.lastTier, 'strong', `${signal} should escalate from cheap judge to strong judge`);
  assert.equal(session.spend.cheapCalls, 1, `${signal} starts with the cheap judge`);
  assert.equal(session.spend.strongCalls, 1, `${signal} invokes the strong judge`);
  assert.ok(session.spend.estimatedTokens > 350, `${signal} includes strong-model token spend`);
  assert.ok(session.spend.estimatedCostUsd > 0.00007, `${signal} includes strong-model dollar spend`);
}

console.log('Convergence watcher — deterministic Slice 6 checks\n');

await check('active sessions infer the opening goal, maintain summary fields, and spend only the cheap judge when calm', () => {
  const result = snapshot([
    userMessage('goal-1', 0, 'Please ship Slice 6 convergence watcher with a Cockpit spend meter.'),
    toolCall('edit-1', 1_000, 'edit', 'edit src/convergence.ts'),
    validationResult('validation-pass-1', 4_000, 'pnpm convergence:check', 0, 'All convergence checks passed.'),
    agentMessage('agent-done-1', 6_000, 'Implemented the watcher and the targeted convergence check passes.'),
  ]);

  const session = onlySession(result);
  assert.equal(session.id, 'claude:slice-6-session');
  assert.equal(session.liveness, 'active');
  assert.equal(session.status, 'calm');
  assert.match(session.summary.goal, /Slice 6 convergence watcher/);
  assert.ok(session.summary.done.some((item) => item.includes('edit src/convergence.ts')), 'edit command is retained in the running summary');
  assert.ok(session.summary.validation.includes('pnpm convergence:check exited 0'), 'passing validation is retained in the running summary');
  assert.deepEqual(session.evidence, []);
  assert.equal(session.judge.lastTier, 'cheap');
  assert.equal(session.spend.cheapCalls, 1);
  assert.equal(session.spend.strongCalls, 0);
  assert.equal(result.spend.cheapCalls, 1);
  assert.equal(result.spend.strongCalls, 0);
  assert.ok(result.nextPollMs > 0, 'endpoint snapshot carries the next Cockpit poll hint');
});

await check('failed validation flips the session to watch and references the failing validation event', () => {
  const result = snapshot([
    userMessage('goal-2', 0, 'Finish the convergence watcher and prove it with the targeted check.'),
    validationResult('validation-fail-1', 3_000, 'pnpm convergence:check', 1, 'Expected status watch, received calm.'),
  ]);

  assertStatusWithEvidence(result, 'watch', 'weak_validation', 'validation-fail-1');
  assert.match(onlySession(result).summary.concerns[0] ?? '', /Validation failed/);
});

await check('hard signals escalate cheap to strong for completion without evidence, repeated failures, and burn spikes', () => {
  const cases: Array<{
    name: string;
    events: LoopwatchEvent[];
    status: ConvergenceStatus;
    signal: ConvergenceSignal;
    eventId: string;
    config?: ConvergenceConfig;
  }> = [
    {
      name: 'completion claim without validation evidence',
      events: [userMessage('goal-3', 0, 'Ship the watcher only after validation evidence exists.'), agentMessage('done-without-proof', 2_000, 'Done — the convergence watcher is ready to ship.')],
      status: 'intervention',
      signal: 'completion_without_evidence',
      eventId: 'done-without-proof',
    },
    {
      name: 'repeated identical validation failures',
      events: [
        userMessage('goal-4', 0, 'Make the convergence check pass.'),
        validationResult('validation-fail-2', 2_000, 'pnpm convergence:check', 1, 'First failure.'),
        validationResult('validation-fail-3', 5_000, 'pnpm convergence:check', 1, 'Same failure again.'),
      ],
      status: 'intervention',
      signal: 'churn',
      eventId: 'validation-fail-3',
    },
    {
      name: 'token burn spike',
      events: [userMessage('goal-5', 0, 'Keep the watcher affordable.'), usage('usage-spike-1', 7_000, 42_000)],
      status: 'watch',
      signal: 'burn',
      eventId: 'usage-spike-1',
      config: { burnTokenThreshold: 10_000 },
    },
  ];

  for (const item of cases) {
    const result = snapshot(item.events, item.config);
    assertStatusWithEvidence(result, item.status, item.signal, item.eventId);
    assert.deepEqual(evidenceSignals(result), [item.signal], item.name);
  }
});

await check('per-session rate cap suppresses a second judge spend while still accepting new meaningful events', () => {
  const registry = createConvergenceWatcherRegistry();
  const first = snapshot([userMessage('goal-6', 0, 'Keep the judge event-driven and rate capped.')], { registry, nowMs: baseMs + 5_000, minJudgeIntervalMs: 60_000 });
  const firstSession = onlySession(first);
  assert.equal(firstSession.spend.cheapCalls, 1);
  assert.equal(firstSession.meaningfulEventCount, 1);

  const second = snapshot([userMessage('goal-6', 0, 'Keep the judge event-driven and rate capped.'), toolCall('edit-2', 10_000, 'edit', 'edit src/convergence.ts')], {
    registry,
    nowMs: baseMs + 11_000,
    minJudgeIntervalMs: 60_000,
  });
  const secondSession = onlySession(second);
  assert.equal(secondSession.meaningfulEventCount, 2, 'the new edit is still observed as meaningful activity');
  assert.equal(secondSession.spend.cheapCalls, 1, 'rate cap prevents a second cheap judge call inside the window');
  assert.equal(secondSession.spend.strongCalls, 0, 'rate cap prevents strong-model spend inside the window');
  assert.equal(second.spend.totalCalls, first.spend.totalCalls, 'global spend meter is unchanged inside the rate-cap window');
  assert.equal(secondSession.judge.nextEligibleAt, iso(65_000));
});

await check('global spend remains cumulative after sessions leave the current run window', () => {
  const registry = createConvergenceWatcherRegistry();
  const first = snapshot([event({ id: 'retired-start', sessionId: 'retired-session', atMs: 0, kind: 'message', actor: { type: 'user' }, payload: { text: 'Track spend even after this session leaves the run window.' } })], {
    registry,
    nowMs: baseMs + 5_000,
  });
  assert.equal(first.spend.totalCalls, 1);
  assert.equal(onlySession(first).spend.totalCalls, 1);

  const second = snapshot([event({ id: 'current-start', sessionId: 'current-session', atMs: 10_000, kind: 'message', actor: { type: 'user' }, payload: { text: 'Keep the live session list current while preserving aggregate spend.' } })], {
    registry,
    nowMs: baseMs + 15_000,
  });
  assert.equal(second.sessions.length, 1, 'only the current run-window session remains visible');
  assert.equal(onlySession(second).id, 'claude:current-session');
  assert.equal(onlySession(second).spend.totalCalls, 1, 'new current session owns only its own spend');
  assert.equal(second.spend.totalCalls, 2, 'aggregate spend retains the retired session call plus the current session call');

  const third = snapshot([event({ id: 'retired-return', sessionId: 'retired-session', atMs: 20_000, kind: 'message', actor: { type: 'user' }, payload: { text: 'Resume the retired session without double-counting its prior spend.' } })], {
    registry,
    nowMs: baseMs + 25_000,
  });
  assert.equal(onlySession(third).id, 'claude:retired-session');
  assert.equal(onlySession(third).spend.totalCalls, 2, 're-emerging session resumes its prior per-session spend');
  assert.equal(third.spend.totalCalls, 3, 'aggregate spend counts each judge call once across session retirement and re-emergence');
});


await check('idle sessions go quiet and do not spend even when their transcript contains meaningful events', () => {
  const result = snapshot([userMessage('goal-7', 0, 'Do not spend LLM calls after the session goes idle.')], {
    nowMs: baseMs + 10 * 60_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  const session = onlySession(result);
  assert.equal(session.liveness, 'idle');
  assert.equal(session.judge.lastTier, undefined);
  assert.equal(session.spend.totalCalls, 0);
  assert.equal(result.spend.totalCalls, 0);
});

if (failures > 0) {
  console.error(`\n${failures} convergence watcher check(s) failed.`);
  process.exit(1);
}

console.log('\nAll convergence watcher checks passed.');
