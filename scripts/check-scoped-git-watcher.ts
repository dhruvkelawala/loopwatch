/**
 * Deterministic scoped-git-watcher checks for issue #12.
 *
 * Fixture-only: creates isolated temporary git repositories, does not touch live
 * user repos, the browser, or the local Loopwatch engine.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { ConvergenceSnapshot } from '../src/convergence.js';
import type { GitEvidenceSnapshot } from '../src/git-watch.js';
import type { LoopwatchEvent } from '../src/events.js';
import { buildConvergenceSnapshot, createConvergenceWatcherRegistry } from '../src/convergence.js';
import { buildScopedGitEvidenceEvents, gitSnapshotFromEvent } from '../src/git-watch.js';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

const baseMs = Date.parse('2026-07-04T12:00:00.000Z');
const nowMs = baseMs + 20_000;
const activeAfterMs = 5 * 60_000;
const commitDate = '2026-07-04T11:45:00Z';
const activeSession = 'scoped-git-active-session';


type EventInput = {
  id: string;
  atMs: number;
  kind: string;
  actor: LoopwatchEvent['actor'];
  repoRoot: string;
  payload?: unknown;
  sessionId?: string;
};

function event(input: EventInput): LoopwatchEvent {
  return {
    source: 'claude',
    sessionId: input.sessionId ?? activeSession,
    timestamp: new Date(baseMs + input.atMs).toISOString(),
    kind: input.kind,
    actor: input.actor,
    context: { cwd: input.repoRoot, repo: basename(input.repoRoot) },
    payload: input.payload ?? { id: input.id },
  };
}

function sessionStart(repoRoot: string, sessionId = activeSession): LoopwatchEvent {
  return event({
    id: `${sessionId}-start`,
    atMs: 0,
    kind: 'session',
    actor: { type: 'system' },
    repoRoot,
    sessionId,
    payload: { id: `${sessionId}-start`, state: 'active' },
  });
}

function userMessage(id: string, atMs: number, repoRoot: string, text: string, sessionId = activeSession): LoopwatchEvent {
  return event({ id, atMs, kind: 'message', actor: { type: 'user' }, repoRoot, sessionId, payload: { id, text } });
}

function agentMessage(id: string, atMs: number, repoRoot: string, text: string, sessionId = activeSession): LoopwatchEvent {
  return event({ id, atMs, kind: 'message', actor: { type: 'agent' }, repoRoot, sessionId, payload: { id, text } });
}

function validationResult(id: string, atMs: number, repoRoot: string, command: string, exitCode: number, sessionId = activeSession): LoopwatchEvent {
  return event({
    id,
    atMs,
    kind: 'tool_result',
    actor: { type: 'tool', name: 'bash' },
    repoRoot,
    sessionId,
    payload: { id, command, exitCode, output: `${command} exited ${exitCode}` },
  });
}

function initRepo(repoRoot: string, branch: string, subject: string) {
  execFileSync('git', ['init', '-b', branch, repoRoot], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Loopwatch Test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'loopwatch@example.invalid'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'add', 'README.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', subject], {
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: commitDate,
      GIT_COMMITTER_DATE: commitDate,
    },
  });
}


function payloadRecord(event: LoopwatchEvent): Record<string, unknown> {
  assert.ok(event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload), 'event payload is a record');
  return event.payload as Record<string, unknown>;
}

function gitEvidenceId(event: LoopwatchEvent): string {
  const id = payloadRecord(event).id;
  if (typeof id !== 'string') assert.fail('git evidence payload carries an id');
  return id;
}

function onlyGitSnapshot(events: LoopwatchEvent[]): { event: LoopwatchEvent; snapshot: GitEvidenceSnapshot } {
  assert.equal(events.length, 1, 'scoped watcher should emit exactly one git evidence event');
  const [gitEvent] = events;
  assert.equal(gitEvent.kind, 'git');
  const snapshot = gitSnapshotFromEvent(gitEvent);
  assert.ok(snapshot, 'git evidence event should decode to a git snapshot');
  return { event: gitEvent, snapshot };
}

function snapshotWithGit(events: LoopwatchEvent[], gitEvents: LoopwatchEvent[]): ConvergenceSnapshot {
  return buildConvergenceSnapshot([...events, ...gitEvents], {
    nowMs,
    minJudgeIntervalMs: 60_000,
    idleAfterMs: 5 * 60_000,
    endedAfterMs: 30 * 60_000,
    registry: createConvergenceWatcherRegistry(),
  });
}

console.log('Scoped git watcher — deterministic checks\n');

const tempRoot = await realpath(await mkdtemp(join(tmpdir(), 'lw-scoped-git-')));
try {
  const activeRepo = join(tempRoot, 'active-repo');
  const inactiveRepo = join(tempRoot, 'inactive-repo');
  await mkdir(activeRepo, { recursive: true });
  await mkdir(inactiveRepo, { recursive: true });
  await writeFile(join(activeRepo, 'README.md'), 'active baseline\n');
  await writeFile(join(inactiveRepo, 'README.md'), 'inactive baseline\n');

  initRepo(activeRepo, 'slice-10-active', 'active initial commit');
  initRepo(inactiveRepo, 'slice-10-inactive', 'inactive initial commit');

  await writeFile(join(activeRepo, 'README.md'), 'active baseline\nactive dirty line\n');
  await writeFile(join(inactiveRepo, 'README.md'), 'inactive baseline\ninactive dirty line\n');

  const activeHead = execFileSync('git', ['-C', activeRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  await check('scopes git evidence to active sessions and ignores stale dirty repos', () => {
    const staleSession = 'stale-inactive-session';
    const staleLastAtMs = nowMs - baseMs - activeAfterMs - 1;
    const events = [
      event({
        id: 'stale-inactive-start',
        atMs: staleLastAtMs - 1_000,
        kind: 'session',
        actor: { type: 'system' },
        repoRoot: inactiveRepo,
        sessionId: staleSession,
        payload: { id: 'stale-inactive-start', state: 'active' },
      }),
      userMessage('stale-inactive-goal', staleLastAtMs, inactiveRepo, 'This stale repo is dirty but inactive.', staleSession),
      sessionStart(activeRepo),
      userMessage('scope-goal', 1_000, activeRepo, 'Watch only the active repo.'),
      validationResult('older-validation', 4_000, activeRepo, 'pnpm older:check', 2),
      validationResult('latest-validation', 8_000, activeRepo, 'pnpm git:check', 1),
      agentMessage('scope-done', 16_000, activeRepo, 'Implemented the scoped git watcher.'),
    ];

    const gitEvents = buildScopedGitEvidenceEvents(events, { nowMs, activeAfterMs, timeoutMs: 5_000 });
    assert.equal(
      gitEvents.some((event) => gitSnapshotFromEvent(event)?.repoRoot === inactiveRepo),
      false,
      'dirty stale inactive repo must not emit git evidence',
    );
    const { event: gitEvent, snapshot } = onlyGitSnapshot(gitEvents);

    assert.equal(gitEvent.source, 'claude');
    assert.equal(gitEvent.sessionId, activeSession);
    assert.equal(gitEvent.context?.cwd, activeRepo);
    assert.equal(gitEvent.context?.repo, 'active-repo');
    assert.equal(gitEvent.context?.gitBranch, 'slice-10-active');

    assert.equal(snapshot.repoRoot, activeRepo);
    assert.equal(snapshot.repo, 'active-repo');
    assert.notEqual(snapshot.repoRoot, inactiveRepo, 'dirty inactive repo must not be sampled without an active session event');
    assert.equal(snapshot.branch, 'slice-10-active');
    assert.equal(snapshot.dirty, true);
    assert.deepEqual(snapshot.changedFiles, ['README.md']);
    assert.deepEqual(snapshot.diff, { files: 1, insertions: 1, deletions: 0 });
    assert.deepEqual(snapshot.head, { sha: activeHead, subject: 'active initial commit', committedAt: commitDate });
    assert.deepEqual(snapshot.validation, {
      status: 'failed',
      detail: 'pnpm git:check exited 1',
      eventId: 'latest-validation',
    });
  });

  await check('keeps validation evidence session-specific when active sessions share a repo', () => {
    const failedSession = 'same-repo-validation-failed';
    const passedSession = 'same-repo-validation-passed';
    const events = [
      sessionStart(activeRepo, failedSession),
      sessionStart(activeRepo, passedSession),
      userMessage('same-repo-failed-goal', 1_000, activeRepo, 'Finish the shared repo work with proof.', failedSession),
      userMessage('same-repo-passed-goal', 1_500, activeRepo, 'Finish another shared repo task with proof.', passedSession),
      validationResult('same-repo-failed-validation', 7_000, activeRepo, 'pnpm git:check', 1, failedSession),
      validationResult('same-repo-passed-validation', 8_000, activeRepo, 'pnpm git:check', 0, passedSession),
      agentMessage('same-repo-failed-done', 16_000, activeRepo, 'Done — validation failed.', failedSession),
      agentMessage('same-repo-passed-done', 16_500, activeRepo, 'Done — validation passed.', passedSession),
    ];

    const gitEvents = buildScopedGitEvidenceEvents(events, { nowMs, activeAfterMs, timeoutMs: 5_000 });
    assert.equal(gitEvents.length, 2, 'same-repo active sessions should each emit git evidence');

    const snapshotsBySession = new Map<string, GitEvidenceSnapshot>();
    for (const gitEvent of gitEvents) {
      assert.equal(gitEvent.kind, 'git');
      assert.equal(gitEvent.context?.cwd, activeRepo);
      const snapshot = gitSnapshotFromEvent(gitEvent);
      assert.ok(snapshot, 'git evidence event should decode to a git snapshot');
      assert.equal(snapshot.repoRoot, activeRepo);
      snapshotsBySession.set(gitEvent.sessionId, snapshot);
    }

    assert.deepEqual(snapshotsBySession.get(failedSession)?.validation, {
      status: 'failed',
      detail: 'pnpm git:check exited 1',
      eventId: 'same-repo-failed-validation',
    });
    assert.deepEqual(snapshotsBySession.get(passedSession)?.validation, {
      status: 'passed',
      detail: 'pnpm git:check exited 0',
      eventId: 'same-repo-passed-validation',
    });
  });

  await check('dirty git evidence backs completion-without-proof convergence intervention', () => {
    const events = [
      sessionStart(activeRepo, 'dirty-no-proof'),
      userMessage('dirty-goal', 1_000, activeRepo, 'Finish Slice 10 with proof.', 'dirty-no-proof'),
      validationResult('dirty-validation-failed', 7_000, activeRepo, 'pnpm git:check', 1, 'dirty-no-proof'),
      agentMessage('dirty-done', 16_000, activeRepo, 'Done — the scoped git watcher is complete.', 'dirty-no-proof'),
    ];
    const gitEvents = buildScopedGitEvidenceEvents(events, { nowMs, activeAfterMs, timeoutMs: 5_000 });
    const { event: gitEvent, snapshot } = onlyGitSnapshot(gitEvents);
    assert.equal(snapshot.validation.status, 'failed');

    const result = snapshotWithGit(events, gitEvents);
    assert.equal(result.sessions.length, 1);
    const [session] = result.sessions;
    assert.equal(session.status, 'intervention');
    assert.deepEqual(session.git, snapshot);

    const dirtyCompletion = session.evidence.find((item) => item.signal === 'completion_without_evidence');
    assert.ok(dirtyCompletion, 'dirty completion should produce completion_without_evidence');
    assert.equal(dirtyCompletion.eventId, gitEvidenceId(gitEvent));
    assert.equal(dirtyCompletion.kind, 'git');
    assert.equal(dirtyCompletion.severity, 'intervention');
    assert.match(dirtyCompletion.detail, /active-repo@slice-10-active: dirty working tree \(1 files, \+1\/-0\)/);
    assert.match(dirtyCompletion.detail, /pnpm git:check exited 1/);
    assert.match(dirtyCompletion.detail, /files: README\.md/);
  });

  await check('passing validation is reflected in git evidence and suppresses dirty-no-proof intervention', () => {
    const events = [
      sessionStart(activeRepo, 'passing-validation'),
      userMessage('passing-goal', 1_000, activeRepo, 'Finish Slice 10 with proof.', 'passing-validation'),
      validationResult('passing-validation-ok', 12_000, activeRepo, 'pnpm git:check', 0, 'passing-validation'),
      agentMessage('passing-done', 16_000, activeRepo, 'Complete — pnpm git:check passes.', 'passing-validation'),
    ];
    const gitEvents = buildScopedGitEvidenceEvents(events, { nowMs, activeAfterMs, timeoutMs: 5_000 });
    const { snapshot } = onlyGitSnapshot(gitEvents);
    assert.deepEqual(snapshot.validation, {
      status: 'passed',
      detail: 'pnpm git:check exited 0',
      eventId: 'passing-validation-ok',
    });

    const result = snapshotWithGit(events, gitEvents);
    assert.equal(result.sessions.length, 1);
    const [session] = result.sessions;
    assert.equal(session.status, 'calm');
    assert.deepEqual(session.git, snapshot);
    assert.equal(session.evidence.some((item) => item.signal === 'completion_without_evidence'), false);
  });
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

if (failures > 0) {
  process.exit(1);
}

console.log('\nAll scoped git watcher checks passed.');
