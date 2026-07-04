/**
 * Deterministic source-parity checks for issue #11.
 *
 * This script stays fixture-only: no live transcript roots, no server, no browser.
 * It verifies that the Codex and Pi JSONL adapters preserve source-native
 * identity/payloads and that the Cockpit session projection exposes truthful
 * source capabilities instead of blank or fabricated data.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { CodexAdapter } from '../src/adapters/codex/adapter.js';
import { PiAdapter } from '../src/adapters/pi/adapter.js';
import type { LoopwatchEvent, LoopwatchEventInput } from '../src/events.js';
import type { SessionView } from '../ui/src/loopwatch-events.js';
import { LoopwatchEventSchema, sessionKey } from '../src/events.js';
import { buildSessionViews } from '../ui/src/loopwatch-events.js';

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


function parseEvents(events: LoopwatchEventInput[]): LoopwatchEvent[] {
  return events.map((event) => LoopwatchEventSchema.parse(event));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function capability(session: SessionView, key: string) {
  const badge = session.capabilities.find((candidate) => candidate.key === key);
  assert.ok(badge, `${session.id} missing ${key} capability badge`);
  return badge;
}

function sessionBySource(sessions: SessionView[], source: string): SessionView {
  const session = sessions.find((candidate) => candidate.source === source);
  assert.ok(session, `missing ${source} session`);
  return session;
}

console.log('Source parity — deterministic checks\n');

const tempRoot = await mkdtemp(join(tmpdir(), 'lw-source-parity-'));
try {
  const codexRoot = join(tempRoot, 'codex-root');
  const codexCursorDir = join(tempRoot, 'codex-cursors');
  const codexTranscript = join(codexRoot, 'sessions', 'rollout-codex-parity-session.jsonl');
  await mkdir(join(codexRoot, 'sessions'), { recursive: true });

  const codexRecords = [
    {
      timestamp: '2026-07-04T11:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'codex-parity-session',
        timestamp: '2026-07-04T11:00:00.000Z',
        cwd: join(tempRoot, 'codex-worktree'),
        cli_version: '0.99.0',
      },
    },
    {
      timestamp: '2026-07-04T11:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg-codex-parity-0001',
        role: 'user',
        content: [{ type: 'input_text', text: 'Verify source parity.' }],
        nativeMarker: { fixture: 'codex-source-parity', nested: true },
      },
    },
    {
      timestamp: '2026-07-04T11:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: 'fc-codex-parity-0002',
        name: 'shell',
        arguments: { command: 'pnpm tsc' },
      },
    },
    {
      timestamp: '2026-07-04T11:00:09.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco-codex-parity-0003',
        output: 'TypeScript passed.',
      },
    },
  ];
  await writeFile(codexTranscript, `${codexRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);

  const codexIngested: LoopwatchEventInput[] = [];
  await check('CodexAdapter emits valid normalized events with source/file identity and preserved raw payloads', async () => {
    const adapter = new CodexAdapter({
      root: codexRoot,
      cursorDir: codexCursorDir,
      initialAnchor: 'start',
      ingest: async (events) => {
        codexIngested.push(...events);
      },
    });
    const summary = await adapter.scanOnce(Date.parse('2026-07-04T11:01:00.000Z'));
    assert.equal(summary.scannedFiles, 1, 'the temp Codex transcript is discovered');
    assert.equal(summary.ingestedEvents, 4, 'all Codex records are emitted');

    const events = parseEvents(codexIngested);
    assert.deepEqual(events.map((event) => event.kind), ['session', 'message', 'tool_call', 'tool_result']);
    assert.deepEqual(events.map((event) => event.actor.type), ['system', 'user', 'agent', 'tool']);
    for (const event of events) {
      assert.equal(event.source, 'codex');
      assert.equal(event.sessionId, 'codex-parity-session', 'session id falls back to rollout filename instead of per-item payload.id');
      assert.equal(sessionKey(event), 'codex:codex-parity-session');
    }
    assert.equal(events[0].context?.cwd, join(tempRoot, 'codex-worktree'), 'session metadata carries cwd context');
    assert.deepEqual(events[1].payload, codexRecords[1], 'Codex raw nested response item survives unchanged as payload');
    assert.deepEqual((recordValue(events[1].payload)!.payload as Record<string, unknown>).nativeMarker, {
      fixture: 'codex-source-parity',
      nested: true,
    });
  });

  const piRepo = join(tempRoot, 'pi-repo');
  const piRoot = join(tempRoot, 'pi-root');
  const piCursorDir = join(tempRoot, 'pi-cursors');
  const piTranscript = join(piRoot, 'sessions', 'pi-parity-session.jsonl');
  await mkdir(join(piRoot, 'sessions'), { recursive: true });
  await mkdir(piRepo, { recursive: true });
  execFileSync('git', ['init', '-b', 'source-parity-branch', piRepo], { stdio: 'ignore' });
  execFileSync('git', ['-C', piRepo, '-c', 'user.name=Loopwatch Source Parity', '-c', 'user.email=source-parity@example.invalid', 'commit', '--allow-empty', '-m', 'source parity fixture'], { stdio: 'ignore' });

  const piRecords = [
    {
      source: 'pi',
      event: 'session.started',
      id: 'pi-parity-0001',
      sessionId: 'pi-parity-session',
      ts: '2026-07-04T11:02:00.000Z',
      actor: { type: 'system', agent: 'pi' },
      cwd: piRepo,
    },
    {
      source: 'pi',
      event: 'model_usage',
      id: 'pi-parity-0002',
      sessionId: 'pi-parity-session',
      ts: '2026-07-04T11:02:04.000Z',
      actor: { type: 'system', agent: 'pi' },
      cwd: piRepo,
      usage: { input: 17, output: 25, cost: { total: 0.0042, currency: 'USD' } },
    },
    {
      source: 'pi',
      event: 'validation.result',
      id: 'pi-parity-0003',
      sessionId: 'pi-parity-session',
      ts: '2026-07-04T11:02:09.000Z',
      actor: { type: 'tool', name: 'pnpm' },
      cwd: piRepo,
      validation: { command: 'pnpm source:check', exitCode: 0 },
    },
  ];
  await writeFile(piTranscript, `${piRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);

  const piIngested: LoopwatchEventInput[] = [];
  await check('PiAdapter preserves usage payloads and infers repo/branch from git when transcript branch is absent', async () => {
    const adapter = new PiAdapter({
      root: piRoot,
      cursorDir: piCursorDir,
      initialAnchor: 'start',
      ingest: async (events) => {
        piIngested.push(...events);
      },
    });
    const summary = await adapter.scanOnce(Date.parse('2026-07-04T11:03:00.000Z'));
    assert.equal(summary.scannedFiles, 1, 'the temp Pi transcript is discovered');
    assert.equal(summary.ingestedEvents, 3, 'all Pi records are emitted');

    const events = parseEvents(piIngested);
    assert.deepEqual(events.map((event) => event.kind), ['session', 'usage', 'tool_result']);
    for (const event of events) {
      assert.equal(event.source, 'pi');
      assert.equal(event.sessionId, 'pi-parity-session');
      assert.equal(sessionKey(event), 'pi:pi-parity-session');
      assert.equal(event.context?.cwd, piRepo);
      assert.equal(event.context?.repo, basename(piRepo));
      assert.equal(event.context?.gitBranch, 'source-parity-branch');
    }
    assert.deepEqual(events[1].payload, piRecords[1], 'Pi usage raw record survives unchanged as payload');
    assert.deepEqual((events[1].payload as Record<string, unknown>).usage, piRecords[1].usage, 'direct Pi token/cost fields remain source-native payload data');
  });

  const claudeEvent = LoopwatchEventSchema.parse({
    source: 'claude',
    sessionId: 'claude-parity-session',
    timestamp: '2026-07-04T10:59:00.000Z',
    kind: 'message',
    actor: { type: 'user' },
    context: { cwd: join(tempRoot, 'claude-worktree'), gitBranch: 'main' },
    payload: { message: { role: 'user', content: [{ type: 'text', text: 'Compare all sources.' }] } },
  });

  await check('Cockpit session projection contains Claude, Codex, and Pi source labels', () => {
    const sessions = buildSessionViews([
      claudeEvent,
      ...parseEvents(codexIngested),
      ...parseEvents(piIngested),
    ], Date.parse('2026-07-04T11:04:00.000Z'));
    assert.deepEqual(sessions.map((session) => session.source).sort(), ['Claude', 'Codex', 'Pi']);
    assert.equal(sessionBySource(sessions, 'Claude').id, 'claude:claude-parity-session');
    assert.equal(sessionBySource(sessions, 'Codex').id, 'codex:codex-parity-session');
    assert.equal(sessionBySource(sessions, 'Pi').id, 'pi:pi-parity-session');
  });

  await check('Capability badges report available data and missing data truthfully', () => {
    const sessions = buildSessionViews([
      claudeEvent,
      ...parseEvents(codexIngested),
      ...parseEvents(piIngested),
    ], Date.parse('2026-07-04T11:04:00.000Z'));
    const codex = sessionBySource(sessions, 'Codex');
    const pi = sessionBySource(sessions, 'Pi');

    assert.equal(codex.branch, 'branch unavailable', 'Codex session with no branch context shows unavailable copy, not blank/fake branch');
    assert.deepEqual(capability(codex, 'tokens'), {
      key: 'tokens',
      label: 'tokens',
      state: 'unavailable',
      detail: 'Codex usage is not exposed as shared core data',
    });
    assert.deepEqual(capability(codex, 'cost'), {
      key: 'cost',
      label: 'cost',
      state: 'unavailable',
      detail: 'Codex cost is unavailable',
    });
    assert.deepEqual(capability(codex, 'branch'), {
      key: 'branch',
      label: 'branch',
      state: 'unavailable',
      detail: 'branch unavailable',
    });

    assert.equal(pi.repo, basename(piRepo));
    assert.equal(pi.branch, 'source-parity-branch');
    assert.deepEqual(capability(pi, 'cost'), {
      key: 'cost',
      label: 'cost',
      state: 'available',
      detail: 'direct Pi cost observed',
    });
    assert.deepEqual(capability(pi, 'tokens'), {
      key: 'tokens',
      label: 'tokens',
      state: 'available',
      detail: 'token usage observed',
    });
    assert.deepEqual(capability(pi, 'branch'), {
      key: 'branch',
      label: 'branch',
      state: 'available',
      detail: 'branch inferred from git/worktree',
    });
  });
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} source parity check(s) failed.`);
  process.exit(1);
}
console.log('\nAll source parity checks passed.');
