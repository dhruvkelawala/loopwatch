import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  buildConvergenceSnapshot,
  createConvergenceWatcherRegistry,
  type ConvergenceConfig,
  type ConvergenceSnapshot,
  type ConvergenceStatus,
  type ConvergenceSignal,
  type SessionConvergenceState,
} from '../src/convergence.js';
import type { LoopwatchEvent } from '../src/events.js';
import { STARTER_LOOPS, type Loop } from '../src/loops.js';

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

const LoopAnchorSchema = z.object({
  loopId: z.string().min(1),
  source: z.literal('opening_prompt'),
  confidence: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1).optional(),
  stopCondition: z.object({
    evidence: z.string().min(1),
    observable: z.boolean(),
  }),
});
type LoopAnchor = z.infer<typeof LoopAnchorSchema>;

type LoopAnchoringConfig = ConvergenceConfig & {
  loopAnchoring?: {
    loops?: Loop[];
    confidenceThreshold?: number;
  };
};

type PivotNudgeConfig = LoopAnchoringConfig & {
  pivotMode?: 'calm' | 'loud';
};
type ExpectedPivotNudge = {
  id: string;
  eventId: string;
  timestamp: string;
  mode: 'calm' | 'loud';
  source: 'user_redirection';
  title: string;
  detail: string;
  recommendedAction: string;
  fromGoal: string;
  toGoal: string;
};

type SessionWithPivotNudge = SessionConvergenceState & {
  pivotNudge?: ExpectedPivotNudge;
};

const PostSessionInsightSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  createdAt: z.string().min(1),
  source: z.literal('post_session'),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
  evidenceEventIds: z.array(z.string().min(1)).min(1),
  signal: z.enum(['drift', 'burn', 'weak_validation', 'churn', 'completion_without_evidence']),
});
type ExpectedPostSessionInsight = z.infer<typeof PostSessionInsightSchema>;

type SessionWithPostSessionInsight = SessionConvergenceState & {
  postSessionInsight?: unknown;
};


function loopById(loops: Loop[], id: string): Loop {
  const loop = loops.find((candidate) => candidate.id === id);
  assert.ok(loop, `expected loop ${id} to exist in the fixture library`);
  return loop;
}

const featureSliceLoop = loopById(STARTER_LOOPS, 'vertical-feature-slice');
const semanticOnlyLoop: Loop = {
  id: 'semantic-review-readiness',
  title: 'Semantic Review Readiness',
  summary: 'Decide whether a design explanation satisfies reviewer concerns when the proof is qualitative.',
  trigger: 'Use when the stop condition is reviewer acceptance, design reasoning, qualitative diff judgment, or semantic readiness rather than a deterministic command.',
  action: 'Compare the final explanation and diff against the reviewer concerns, then cite the reasoning that resolves them.',
  verification: 'Use LLM or diff judgment over the changed explanation; do not require one exact verification command.',
  memory: 'Record the concerns, reasoning evidence, and diff regions that made the reviewer acceptance plausible.',
  stopCondition: {
    evidence: 'Reviewer concerns are semantically answered by the explanation and diff, with no unresolved contradiction.',
    observable: false,
  },
  tags: ['review', 'semantic', 'diff', 'judgment', 'reasoning', 'acceptance'],
};

function loopAnchoringConfig(loops: Loop[] = STARTER_LOOPS): LoopAnchoringConfig {
  return {
    loopAnchoring: {
      loops,
      confidenceThreshold: 0.5,
    },
  };
}

function snapshot(events: LoopwatchEvent[], config: PivotNudgeConfig = {}): ConvergenceSnapshot {
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

function loopAnchorFor(session: SessionConvergenceState): LoopAnchor {
  if (!('loopAnchor' in session)) assert.fail('expected session.loopAnchor to expose the opening-prompt Loop anchor');
  return LoopAnchorSchema.parse(session.loopAnchor);
}

function assertNoLoopAnchor(session: SessionConvergenceState): void {
  if (!('loopAnchor' in session)) return;
  assert.ok(session.loopAnchor === undefined || session.loopAnchor === null, 'low-confidence opening prompt must remain unanchored');
}

function assertLoopAnchor(session: SessionConvergenceState, loop: Loop, minimumConfidence = 0.5): LoopAnchor {
  const anchor = loopAnchorFor(session);
  assert.equal(anchor.loopId, loop.id, 'session.loopAnchor.loopId is the selected Loop id');
  assert.equal(anchor.source, 'opening_prompt', 'Loop anchor comes from the opening prompt, not later agent evidence');
  assert.ok(anchor.confidence >= minimumConfidence, `anchor confidence ${anchor.confidence} is below the configured threshold ${minimumConfidence}`);
  if (anchor.threshold !== undefined) assert.ok(anchor.confidence >= anchor.threshold, 'anchor confidence clears its exposed threshold');
  assert.deepEqual(anchor.stopCondition, loop.stopCondition, 'session.loopAnchor.stopCondition mirrors the selected Loop stop condition');
  return anchor;
}

function evidenceWithSignal(session: SessionConvergenceState, signal: ConvergenceSignal) {
  const evidence = session.evidence.find((item) => item.signal === signal);
  assert.ok(evidence, `expected convergence evidence with signal ${signal}`);
  return evidence;
}

function assertNoEvidenceSignal(session: SessionConvergenceState, signal: ConvergenceSignal): void {
  assert.equal(session.evidence.some((item) => item.signal === signal), false, `did not expect convergence evidence with signal ${signal}`);
}

function pivotNudgeFor(session: SessionConvergenceState): ExpectedPivotNudge {
  const nudge = (session as SessionWithPivotNudge).pivotNudge;
  assert.ok(nudge, 'expected session.pivotNudge for a user-initiated topic change');
  return nudge;
}

function assertNoPivotNudge(session: SessionConvergenceState): void {
  assert.equal((session as SessionWithPivotNudge).pivotNudge, undefined, 'did not expect a Pivot nudge');
}

function assertFreshSessionRecommendation(nudge: ExpectedPivotNudge): void {
  const record = nudge as Record<string, unknown>;
  assert.match(nudge.recommendedAction, /start a fresh (?:agent )?session/i, 'Pivot nudge recommends starting a fresh session');
  assert.equal('startedSessionId' in record, false, 'Pivot nudge must not report that Loopwatch started a session');
  assert.equal('createdSessionId' in record, false, 'Pivot nudge must not report that Loopwatch created a session');
  assert.equal('controlledSessionId' in record, false, 'Pivot nudge must not claim control of a session');
}

function postSessionInsightFor(session: SessionConvergenceState): ExpectedPostSessionInsight {
  const rawInsight = (session as SessionWithPostSessionInsight).postSessionInsight;
  assert.ok(rawInsight, 'ended sessions with already-computed convergence evidence should expose session.postSessionInsight');
  return PostSessionInsightSchema.parse(rawInsight);
}

function assertNoPostSessionInsight(session: SessionConvergenceState): void {
  assert.equal((session as SessionWithPostSessionInsight).postSessionInsight, undefined, `${session.liveness} session must not expose a post-session insight`);
}

function assertInsightGroundsInEvidence(session: SessionConvergenceState): ExpectedPostSessionInsight {
  const evidence = session.evidence[0];
  assert.ok(evidence, 'test setup expects convergence evidence before asserting a post-session insight');

  const insight = postSessionInsightFor(session);
  assert.equal(insight.sessionId, session.sessionId, 'post-session insight identifies the ended source session');
  assert.ok(Number.isFinite(Date.parse(insight.createdAt)), 'post-session insight exposes a parseable creation timestamp');
  assert.ok(Date.parse(insight.createdAt) >= Date.parse(evidence.timestamp), 'post-session insight is not timestamped before the evidence it cites');
  assert.equal(insight.source, 'post_session');
  assert.deepEqual(insight.evidenceEventIds, [evidence.eventId], 'post-session insight cites the evidence receipt it learned from');
  assert.equal(insight.signal, evidence.signal, 'post-session insight preserves the convergence signal it learned from');
  assert.ok(insight.detail.includes(evidence.detail), 'post-session insight detail quotes the evidence detail instead of emitting generic advice');
  return insight;
}

function assertConcreteInsightRecommendation(insight: ExpectedPostSessionInsight, expectedEvidenceSpecificCopy: RegExp): void {
  assert.match(insight.recommendation, expectedEvidenceSpecificCopy, 'post-session coaching recommendation should name the concrete next behavior implied by the evidence');
  assert.doesNotMatch(
    insight.recommendation,
    /\b(?:be careful|do better|keep going|try again|review the work|consider improving|reflect on the session|learn from this)\b/i,
    'post-session coaching recommendation must not be a generic productivity tip',
  );
}

function endedSessionAfterAlreadyComputedEvidence(events: LoopwatchEvent[], config: PivotNudgeConfig = {}): SessionConvergenceState {
  const registry = createConvergenceWatcherRegistry();
  const active = snapshot(events, {
    ...config,
    registry,
    nowMs: baseMs + 12_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  const activeSession = onlySession(active);
  assert.equal(activeSession.liveness, 'active', 'setup first computes convergence evidence while the session is still active');
  assert.ok(activeSession.evidence.length > 0, 'setup should have already-computed convergence evidence');

  const ended = snapshot(events, {
    ...config,
    registry,
    nowMs: baseMs + 45 * 60_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  const endedSession = onlySession(ended);
  assert.equal(endedSession.liveness, 'ended');
  assert.deepEqual(
    endedSession.evidence.map((item) => ({ eventId: item.eventId, signal: item.signal, detail: item.detail })),
    activeSession.evidence.map((item) => ({ eventId: item.eventId, signal: item.signal, detail: item.detail })),
    'post-session coaching must reuse already-computed convergence evidence instead of re-judging the ended session',
  );
  return endedSession;
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

await check('opening feature-slice prompt anchors the vertical-feature-slice Loop on the session', () => {
  const result = snapshot(
    [
      userMessage(
        'loop-goal-feature-slice',
        0,
        'Implement issue #14 Loop auto-detection as a vertical feature slice with acceptance criteria, deterministic tests, and reviewer evidence.',
      ),
    ],
    loopAnchoringConfig(),
  );

  const session = onlySession(result);
  assert.match(session.summary.goal, /Loop auto-detection/);
  assertLoopAnchor(session, featureSliceLoop);
});

await check('low-confidence opening prompt stays unanchored while preserving the inferred goal', () => {
  const prompt = 'Can you summarize why sourdough starter smells different after a cold night?';
  const result = snapshot([userMessage('loop-goal-unrelated', 0, prompt)], loopAnchoringConfig());

  const session = onlySession(result);
  assertNoLoopAnchor(session);
  assert.equal(session.summary.goal, prompt);
  assert.equal(session.status, 'calm');
});

await check('anchored completion without stop-condition evidence raises weak validation citing the Loop stop condition', () => {
  const result = snapshot(
    [
      userMessage(
        'loop-goal-missing-stop-proof',
        0,
        'Ship issue #14 as a vertical feature slice: implement loop auto-detection, satisfy every acceptance criterion, and record reviewer evidence.',
      ),
      validationResult('types-only-pass', 2_000, 'pnpm tsc --noEmit', 0, 'TypeScript passed.'),
      agentMessage('premature-loop-done', 4_000, 'Done — issue #14 is complete and ready to ship.'),
    ],
    loopAnchoringConfig(),
  );

  const session = onlySession(result);
  assertLoopAnchor(session, featureSliceLoop);
  assert.notEqual(session.status, 'calm', 'a completion claim without Loop stop-condition evidence must not stay calm');
  const evidence = evidenceWithSignal(session, 'weak_validation');
  assert.ok(
    evidence.detail.includes(featureSliceLoop.stopCondition.evidence),
    'weak-validation evidence cites the anchored Loop stop condition',
  );
});

await check('anchored completion with validation evidence matching the stop condition stays calm', () => {
  const result = snapshot(
    [
      userMessage(
        'loop-goal-stop-proof',
        0,
        'Implement issue #14 as one vertical feature slice and close it only when deterministic harness output and reviewer sign-off prove every acceptance criterion.',
      ),
      validationResult(
        'loop-stop-condition-pass',
        3_000,
        'pnpm convergence:check',
        0,
        'All stated acceptance criteria pass with deterministic harness output and reviewer sign-off; no unverified TODO or shim remains.',
      ),
      agentMessage('loop-stop-done', 5_000, 'Done — the deterministic harness output and reviewer sign-off satisfy the Loop stop condition.'),
    ],
    loopAnchoringConfig(),
  );

  const session = onlySession(result);
  assertLoopAnchor(session, featureSliceLoop);
  assert.equal(session.status, 'calm');
  assert.deepEqual(session.evidence, []);
});

await check('semantic-only stop conditions use judge/diff evidence without exact command matching false positives', () => {
  const result = snapshot(
    [
      userMessage(
        'semantic-loop-goal',
        0,
        'Use the Semantic Review Readiness loop to decide whether the reviewer concerns are resolved by the design explanation and diff judgment.',
      ),
      validationResult(
        'semantic-judge-pass',
        3_000,
        'pnpm semantic:check',
        0,
        'Diff judgment passed: the changed explanation resolves the reviewer concerns and leaves no unresolved contradiction.',
      ),
      agentMessage('semantic-loop-done', 5_000, 'Done — the reviewer concerns are semantically resolved by the explanation and diff.'),
    ],
    loopAnchoringConfig([...STARTER_LOOPS, semanticOnlyLoop]),
  );

  const session = onlySession(result);
  const anchor = assertLoopAnchor(session, semanticOnlyLoop);
  assert.equal(anchor.stopCondition.observable, false, 'fixture Loop is semantic-only rather than deterministic-command observable');
  assert.equal(session.status, 'calm');
  assert.deepEqual(session.evidence, []);
  assert.equal(session.judge.lastTier, 'cheap', 'semantic-only stop conditions should not create a false positive that escalates to strong judge');
});

await check('mid-session user topic change creates a calm Pivot nudge by default without classifying it as Drift', () => {
  const result = snapshot([
    userMessage('pivot-goal', 0, 'Ship issue #15 Pivot detection with deterministic convergence and Cockpit tests.'),
    toolCall('pivot-edit', 1_000, 'edit', 'edit src/convergence.ts'),
    validationResult('pivot-validation', 3_000, 'pnpm convergence:check', 0, 'Existing convergence checks passed before the topic changed.'),
    agentMessage('pivot-progress', 4_000, 'Pivot detection tests are in progress and the convergence watcher still passes.'),
    userMessage('pivot-redirection', 7_000, 'Actually, switch topics: help me draft an onboarding email campaign for new workspace admins.'),
  ]);

  const session = onlySession(result);
  assert.equal(session.status, 'calm', 'default Pivot mode is calm/non-interruptive');
  assertNoEvidenceSignal(session, 'drift');
  const nudge = pivotNudgeFor(session);
  assert.equal(nudge.eventId, 'pivot-redirection');
  assert.equal(nudge.mode, 'calm');
  assert.equal(nudge.source, 'user_redirection');
  assert.match(nudge.title, /pivot/i);
  assert.match(nudge.fromGoal, /issue #15 Pivot detection/);
  assert.match(nudge.toGoal, /onboarding email campaign/);
  assertFreshSessionRecommendation(nudge);
  assert.equal(session.spend.strongCalls, 0, 'calm Pivot nudges remain cheap/non-interruptive by default');
});

await check('Pivot loud mode marks the same user redirection as a loud fresh-session nudge', () => {
  const result = snapshot(
    [
      userMessage('pivot-loud-goal', 0, 'Complete the Loopwatch Pivot detector tests and wire the Cockpit nudge.'),
      toolCall('pivot-loud-edit', 1_000, 'edit', 'edit tests/e2e/cockpit.spec.ts'),
      agentMessage('pivot-loud-progress', 3_000, 'The Pivot detector test fixture is being added.'),
      userMessage('pivot-loud-redirection', 6_000, 'New task instead: analyze renewal-risk accounts and draft a customer success playbook.'),
    ],
    { pivotMode: 'loud' },
  );

  const session = onlySession(result);
  assertNoEvidenceSignal(session, 'drift');
  const nudge = pivotNudgeFor(session);
  assert.equal(nudge.eventId, 'pivot-loud-redirection');
  assert.equal(nudge.mode, 'loud');
  assert.match(nudge.toGoal, /renewal-risk accounts/);
  assertFreshSessionRecommendation(nudge);
});

await check('agent drift remains a Drift signal and never becomes a user Pivot', () => {
  const result = snapshot([
    userMessage('drift-goal', 0, 'Finish Pivot detection and the fresh-session nudge.'),
    toolCall('drift-edit', 1_000, 'edit', 'edit src/convergence.ts'),
    agentMessage('agent-drift', 4_000, 'Instead of Pivot detection, I am going to refactor unrelated billing settings first.'),
  ]);

  const session = onlySession(result);
  assertNoPivotNudge(session);
  const drift = evidenceWithSignal(session, 'drift');
  assert.equal(drift.eventId, 'agent-drift');
  assert.equal(drift.severity, 'intervention');
});

await check('a single benign refinement of the same task does not create a Pivot nudge', () => {
  const result = snapshot([
    userMessage('clarification-goal', 0, 'Add Pivot detection and keep Loopwatch from starting sessions automatically.'),
    toolCall('clarification-edit', 1_000, 'edit', 'edit scripts/check-convergence-watcher.ts'),
    userMessage('clarification-refinement', 4_000, 'Clarification: keep the default mode calm, and only show a loud card when the user toggles it on.'),
  ]);

  const session = onlySession(result);
  assert.equal(session.status, 'calm');
  assert.deepEqual(session.evidence, []);
  assertNoPivotNudge(session);
});

await check('failed validation flips the session to watch and references the failing validation event', () => {
  const result = snapshot([
    userMessage('goal-2', 0, 'Finish the convergence watcher and prove it with the targeted check.'),
    validationResult('validation-fail-1', 3_000, 'pnpm convergence:check', 1, 'Expected status watch, received calm.'),
  ]);

  assertStatusWithEvidence(result, 'watch', 'weak_validation', 'validation-fail-1');
  assert.match(onlySession(result).summary.concerns[0] ?? '', /Validation failed/);
});

await check('successful non-validation tool results do not count as validation evidence', () => {
  // Claude-shaped tool_use/tool_result pair: `is_error: false` on a plain
  // `git status` must NOT satisfy the completion claim's evidence bar.
  const bashCall = (id: string, atMs: number, toolUseId: string, command: string) =>
    event({
      id,
      atMs,
      kind: 'tool_call',
      actor: { type: 'agent' },
      payload: { id, message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } }] } },
    });
  const bashResult = (id: string, atMs: number, toolUseId: string, output: string) =>
    event({
      id,
      atMs,
      kind: 'tool_result',
      actor: { type: 'tool', name: 'Bash' },
      payload: { id, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: false, content: output }] } },
    });

  const nonValidation = snapshot([
    userMessage('goal-pairing-1', 0, 'Ship the watcher only after validation evidence exists.'),
    bashCall('bash-call-status', 1_000, 'toolu_status', 'git status'),
    bashResult('bash-result-status', 2_000, 'toolu_status', 'clean tree'),
    agentMessage('done-unproven', 3_000, 'Done — the watcher is ready to ship.'),
  ]);
  assertStatusWithEvidence(nonValidation, 'intervention', 'completion_without_evidence', 'done-unproven');

  // The same shape with a real validation command paired by tool_use_id
  // (no explicit exitCode/validation payload) DOES count as evidence.
  const validated = snapshot([
    userMessage('goal-pairing-2', 0, 'Ship the watcher only after validation evidence exists.'),
    bashCall('bash-call-test', 1_000, 'toolu_test', 'pnpm test'),
    bashResult('bash-result-test', 2_000, 'toolu_test', 'all checks passed'),
    agentMessage('done-proven', 3_000, 'Done — the watcher is ready to ship.'),
  ]);
  assert.equal(onlySession(validated).status, 'calm', 'a paired passing validation result satisfies the evidence bar');
});

await check('Codex and Pi native tool shapes count as validation evidence', () => {
  // Codex: `function_call` paired to `exec_command_end` by call_id through the
  // raw `{ type, payload }` envelope the adapter preserves.
  const codexValidated = snapshot([
    userMessage('goal-codex-1', 0, 'Ship only after validation evidence exists.'),
    event({
      id: 'codex-call-test',
      atMs: 1_000,
      kind: 'tool_call',
      actor: { type: 'agent' },
      payload: { id: 'codex-call-test', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pnpm test"}', call_id: 'call_v1' } },
    }),
    event({
      id: 'codex-result-test',
      atMs: 2_000,
      kind: 'tool_result',
      actor: { type: 'tool', name: 'exec' },
      payload: { id: 'codex-result-test', type: 'event_msg', payload: { type: 'exec_command_end', call_id: 'call_v1', exit_code: 0, aggregated_output: 'all passed' } },
    }),
    agentMessage('codex-done', 3_000, 'Done — shipped with passing tests.'),
  ]);
  assert.equal(onlySession(codexValidated).status, 'calm', 'Codex exec_command_end exit 0 satisfies the evidence bar');

  // Codex: a successful non-validation command must NOT count.
  const codexUnproven = snapshot([
    userMessage('goal-codex-2', 0, 'Ship only after validation evidence exists.'),
    event({
      id: 'codex-call-ls',
      atMs: 1_000,
      kind: 'tool_call',
      actor: { type: 'agent' },
      payload: { id: 'codex-call-ls', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}', call_id: 'call_v2' } },
    }),
    event({
      id: 'codex-result-ls',
      atMs: 2_000,
      kind: 'tool_result',
      actor: { type: 'tool', name: 'exec' },
      payload: { id: 'codex-result-ls', type: 'event_msg', payload: { type: 'exec_command_end', call_id: 'call_v2', exit_code: 0 } },
    }),
    agentMessage('codex-done-unproven', 3_000, 'Done — shipped.'),
  ]);
  assertStatusWithEvidence(codexUnproven, 'intervention', 'completion_without_evidence', 'codex-done-unproven');

  // Pi: toolCall content block paired to a toolResult by toolCallId.
  const piValidated = snapshot([
    userMessage('goal-pi-1', 0, 'Ship only after validation evidence exists.'),
    event({
      id: 'pi-call-test',
      atMs: 1_000,
      kind: 'tool_call',
      actor: { type: 'agent' },
      payload: { id: 'pi-call-test', type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'pi_call_1', name: 'bash', arguments: { command: 'pnpm test' } }] } },
    }),
    event({
      id: 'pi-result-test',
      atMs: 2_000,
      kind: 'tool_result',
      actor: { type: 'tool', name: 'bash' },
      payload: { id: 'pi-result-test', type: 'message', message: { role: 'toolResult', toolCallId: 'pi_call_1', isError: false, content: [{ type: 'text', text: 'ok' }] } },
    }),
    agentMessage('pi-done', 3_000, 'Done — shipped with passing tests.'),
  ]);
  assert.equal(onlySession(piValidated).status, 'calm', 'Pi toolResult paired to a validation toolCall satisfies the evidence bar');
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

await check('ended sessions turn already-computed convergence evidence into a grounded post-session Coaching insight', () => {
  const session = endedSessionAfterAlreadyComputedEvidence([
    userMessage('post-session-goal', 0, 'Finish issue #16 with deterministic convergence checks.'),
    validationResult('post-session-validation-fail', 3_000, 'pnpm convergence:check', 1, 'Expected postSessionInsight, received undefined.'),
  ]);

  const insight = assertInsightGroundsInEvidence(session);
  assertConcreteInsightRecommendation(insight, /(?:pnpm convergence:check|failed validation|failing validation|failing test|acceptance check)/i);
});

await check('post-session insight recommendations are concrete and signal-specific', () => {
  const cases: Array<{
    name: string;
    events: LoopwatchEvent[];
    signal: ConvergenceSignal;
    recommendation: RegExp;
    config?: PivotNudgeConfig;
  }> = [
    {
      name: 'repeated failing validation points at the failing check',
      events: [
        userMessage('post-session-churn-goal', 0, 'Make the convergence check pass without repair churn.'),
        validationResult('post-session-churn-one', 2_000, 'pnpm convergence:check', 1, 'First failure.'),
        validationResult('post-session-churn-two', 5_000, 'pnpm convergence:check', 1, 'Same failure again.'),
      ],
      signal: 'churn',
      recommendation: /(?:pnpm convergence:check|failing check|repeated failure|repair loop|validation fails twice|different repair plan)/i,
    },
    {
      name: 'completion without proof asks for validation evidence',
      events: [
        userMessage('post-session-proof-goal', 0, 'Ship issue #16 only with a validation receipt.'),
        agentMessage('post-session-done-without-proof', 4_000, 'Done — issue #16 is complete and ready to ship.'),
      ],
      signal: 'completion_without_evidence',
      recommendation: /(?:validation receipt|passing validation|proof|evidence|exact acceptance check)/i,
    },
    {
      name: 'burn evidence asks for a budgeted reset instead of generic encouragement',
      events: [
        userMessage('post-session-burn-goal', 0, 'Keep the watcher affordable while checking convergence.'),
        usage('post-session-burn-spike', 7_000, 42_000),
      ],
      signal: 'burn',
      recommendation: /(?:token|budget|burn|summarize|reset|smaller loop|explicit stop condition|long run)/i,
      config: { burnTokenThreshold: 10_000 },
    },
  ];
  const recommendations = new Set<string>();

  for (const item of cases) {
    const session = endedSessionAfterAlreadyComputedEvidence(item.events, item.config);
    const evidence = evidenceWithSignal(session, item.signal);
    assert.equal(session.evidence[0]?.eventId, evidence.eventId, item.name);

    const insight = assertInsightGroundsInEvidence(session);
    assert.equal(insight.signal, item.signal, item.name);
    assertConcreteInsightRecommendation(insight, item.recommendation);
    recommendations.add(insight.recommendation);
  }

  assert.equal(recommendations.size, cases.length, 'post-session recommendations should vary with the convergence signal instead of sharing one generic tip');
});

await check('active and idle sessions do not receive post-session insights even when convergence evidence exists', () => {
  const registry = createConvergenceWatcherRegistry();
  const events = [
    userMessage('post-session-active-goal', 0, 'Finish issue #16 with a focused convergence check.'),
    validationResult('post-session-active-validation-fail', 3_000, 'pnpm convergence:check', 1, 'Post-session card is missing.'),
  ];

  const active = snapshot(events, {
    registry,
    nowMs: baseMs + 12_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  const activeSession = onlySession(active);
  assert.equal(activeSession.liveness, 'active');
  evidenceWithSignal(activeSession, 'weak_validation');
  assertNoPostSessionInsight(activeSession);

  const idle = snapshot(events, {
    registry,
    nowMs: baseMs + 10 * 60_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  const idleSession = onlySession(idle);
  assert.equal(idleSession.liveness, 'idle');
  evidenceWithSignal(idleSession, 'weak_validation');
  assertNoPostSessionInsight(idleSession);
});

await check('ended sessions with no convergence evidence do not fabricate post-session insights', () => {
  const registry = createConvergenceWatcherRegistry();
  const events = [
    userMessage('post-session-calm-goal', 0, 'Ship issue #16 after the targeted checks pass.'),
    validationResult('post-session-calm-validation', 3_000, 'pnpm convergence:check', 0, 'All convergence checks passed.'),
  ];

  const active = snapshot(events, {
    registry,
    nowMs: baseMs + 12_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  assert.deepEqual(onlySession(active).evidence, [], 'setup should stay calm while active');

  const ended = snapshot(events, {
    registry,
    nowMs: baseMs + 45 * 60_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
  });
  const endedSession = onlySession(ended);
  assert.equal(endedSession.liveness, 'ended');
  assert.deepEqual(endedSession.evidence, []);
  assertNoPostSessionInsight(endedSession);
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
