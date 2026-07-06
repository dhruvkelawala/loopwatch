/**
 * Slice 5 end-to-end check: Claude adapter → Flue durable run logs → Cockpit
 * live projection.
 *
 * Boots the real Flue Node server, tails a Claude-shaped transcript fixture,
 * discovers the resulting ingest runs through `/loopwatch/runs`, replays those
 * runs' Durable Streams, and proves the same pure projection used by the UI
 * produces a rail row plus populated timeline lanes. A second append verifies
 * live updates arrive as a new ingest run without restarting the server.
 *
 * Run with: pnpm cockpit:check
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { FlueEvent } from '@flue/sdk';
import { ClaudeAdapter, httpIngest } from '../src/adapters/claude/adapter.js';
import { keepIndexedBatches, replayRunIds } from '../ui/src/cockpit/run-index.js';
import { buildSessionViews, recordedLoopwatchEvents, type LoopwatchEvent } from '../ui/src/loopwatch-events.js';

const port = Number(process.env.LOOPWATCH_COCKPIT_CHECK_PORT ?? 3590);
const baseUrl = `http://127.0.0.1:${port}`;
const SID = 'cockpit-live-7564ccd3-db65-438f-a828-1b59cb6489b7';

interface LoopwatchRunsResponse {
  ok: true;
  runs: Array<{ runId: string; workflowName: string; status: 'active' | 'completed' | 'errored'; startedAt: string }>;
}

interface LoopwatchConvergenceResponse {
  ok: true;
  sessions: Array<{
    id: string;
    status: 'calm' | 'watch' | 'intervention';
    summary: { goal: string; validation: string[]; concerns: string[] };
    spend: { cheapCalls: number; strongCalls: number; totalCalls: number; estimatedTokens: number; estimatedCostUsd: number };
  }>;
  spend: { cheapCalls: number; strongCalls: number; totalCalls: number; estimatedTokens: number; estimatedCostUsd: number };
  nextPollMs: number;
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Flue server not ready on ${baseUrl}: ${String(lastError)}`);
}

async function startServer(storageDir: string) {
  const serverEntry = join(process.cwd(), 'dist/server.mjs');
  // The check probes and ingests tokenless, so the spawned engine must not
  // inherit a shell-exported LOOPWATCH_ENGINE_TOKEN and start enforcing auth.
  const { LOOPWATCH_ENGINE_TOKEN: _ignoredEngineToken, ...inherited } = process.env;
  const env = { ...inherited, PORT: String(port) };
  const child = spawn(process.execPath, [serverEntry], {
    cwd: storageDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(5000).then(() => child.kill('SIGKILL')),
    ]);
  };

  try {
    await waitForServer();
  } catch (error) {
    await stop();
    throw error;
  }

  return stop;
}

async function buildServer() {
  await new Promise<void>((resolve, reject) => {
    spawn('pnpm', ['build'], { stdio: 'inherit' }).once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`pnpm build exited ${code}`)),
    );
  });
}

let uuidN = 0;
function rec(extra: Record<string, unknown>, timestamp = new Date().toISOString()): Record<string, unknown> {
  return {
    sessionId: SID,
    uuid: `cockpit-uuid-${++uuidN}`,
    timestamp,
    cwd: '/Users/dhruvkelawala/development/loopwatch',
    gitBranch: 'slice-5',
    version: '2.1.170',
    ...extra,
  };
}

function jsonl(records: Record<string, unknown>[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

async function fetchRunIndex({ limit = 20, scanLimit }: { limit?: number; scanLimit?: number } = {}): Promise<LoopwatchRunsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (scanLimit !== undefined) params.set('scanLimit', String(scanLimit));
  const response = await fetch(`${baseUrl}/loopwatch/runs?${params}`);
  if (!response.ok) throw new Error(`GET /loopwatch/runs failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as LoopwatchRunsResponse;
}

async function fetchConvergence({ limit = 20, scanLimit }: { limit?: number; scanLimit?: number } = {}): Promise<LoopwatchConvergenceResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (scanLimit !== undefined) params.set('scanLimit', String(scanLimit));
  const response = await fetch(`${baseUrl}/loopwatch/convergence?${params}`);
  if (!response.ok) throw new Error(`GET /loopwatch/convergence failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as LoopwatchConvergenceResponse;
}

async function assertDurableStreamHeadersExposed(runId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/runs/${runId}`, { headers: { origin: 'tauri://localhost' } });
  if (!response.ok) throw new Error(`CORS header probe failed: ${response.status} ${await response.text()}`);
  const exposed = response.headers.get('access-control-expose-headers')?.toLowerCase() ?? '';
  for (const header of ['stream-next-offset', 'stream-up-to-date', 'stream-closed', 'stream-cursor']) {
    assert(exposed.includes(header), `CORS expose headers missing ${header}: ${exposed}`);
  }
}

async function fetchRecordedEvents(options?: { limit?: number; scanLimit?: number }): Promise<LoopwatchEvent[]> {
  const index = await fetchRunIndex(options);
  const batches = await Promise.all(
    index.runs.map(async (run) => {
      const response = await fetch(`${baseUrl}/runs/${run.runId}`);
      if (!response.ok) throw new Error(`GET /runs/${run.runId} failed: ${response.status} ${await response.text()}`);
      return recordedLoopwatchEvents((await response.json()) as FlueEvent[]);
    }),
  );
  return batches.flat();
}

function assertLiveReplayRunIndexSemantics(): void {
  const split = replayRunIds([
    { runId: 'run-active', workflowName: 'record-events', status: 'active', startedAt: '2026-06-24T00:00:02.000Z' },
    { runId: 'run-done', workflowName: 'record-events', status: 'completed', startedAt: '2026-06-24T00:00:01.000Z' },
  ]);
  assert.deepEqual(split.indexedRunIds, ['run-active', 'run-done'], 'live replay preserves index order');
  assert.deepEqual(split.activeRunIds, ['run-active'], 'active runs stream through useFlueWorkflow');
  assert.deepEqual(split.completedRunIds, ['run-done'], 'completed runs replay through client.runs.events');

  const event: LoopwatchEvent = { source: 'claude', sessionId: SID, timestamp: new Date().toISOString(), kind: 'message', actor: { type: 'user' } };
  const current = { 'run-active': [event], stale: [event] };
  const kept = keepIndexedBatches(current, split.indexedRunIds);
  assert.deepEqual(Object.keys(kept), ['run-active'], 'stale run batches are pruned only after the run leaves the index');
  assert.strictEqual(keepIndexedBatches(kept, split.indexedRunIds), kept, 'unchanged batch maps keep referential stability');
}

async function main() {
  assertLiveReplayRunIndexSemantics();

  console.log('Building Flue Node server...');
  await buildServer();

  const dir = await mkdtemp(join(tmpdir(), 'lw-cockpit-live-'));
  const storageDir = join(dir, 'engine');
  await mkdir(join(storageDir, 'data'), { recursive: true });

  const root = join(dir, 'projects');
  const projectDir = join(root, '-Users-dhruvkelawala-development-loopwatch');
  const transcript = join(projectDir, `${SID}.jsonl`);
  await mkdir(projectDir, { recursive: true });

  const t0 = new Date().toISOString();
  await writeFile(
    transcript,
    jsonl([
      rec({ type: 'user', message: { role: 'user', content: 'Slice 5: wire the live Claude session into the Cockpit.' } }, t0),
      rec(
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_check', name: 'Bash', input: { command: 'pnpm test' } }],
          },
        },
        t0,
      ),
    ]),
  );

  console.log('Starting server...');
  const stop = await startServer(storageDir);
  try {
    const adapter = new ClaudeAdapter({
      ingest: httpIngest(baseUrl),
      root,
      cursorDir: join(dir, 'cursors'),
      initialAnchor: 'start',
    });

    const first = await adapter.scanOnce(Date.now());
    assert.equal(first.ingestedEvents, 2, 'first scan ingests request + tool call');
    const firstIndex = await fetchRunIndex();
    assert.ok(firstIndex.runs.length > 0, 'run index exposes the first ingest run');
    await assertDurableStreamHeadersExposed(firstIndex.runs[0].runId);

    const firstEvents = await fetchRecordedEvents();
    const firstSessions = buildSessionViews(firstEvents, Date.now());
    assert.equal(firstSessions.length, 1, 'one Agent Session appears in the rail');
    const session = firstSessions[0];
    assert.equal(session.source, 'Claude', 'rail source is Claude');
    assert.equal(session.repo, 'loopwatch', 'rail repo is derived from cwd');
    assert.equal(session.branch, 'slice-5', 'rail branch is captured from event context');
    assert.equal(session.liveness, 'active', 'fresh fixture is active');
    assert.ok(session.elapsed.length > 0, 'rail elapsed is populated');
    assert.ok(session.phase.length > 0, 'rail phase is populated');
    assert.ok(session.lanes.find((lane) => lane.lane === 'request')?.items.length, 'request lane back-fills history');
    assert.ok(session.lanes.find((lane) => lane.lane === 'validation')?.items.length, 'validation lane classifies pnpm test');


    const firstConvergence = await fetchConvergence();
    assert.equal(firstConvergence.sessions.length, 1, 'convergence endpoint watches the live session');
    assert.equal(firstConvergence.sessions[0].id, `claude:${SID}`, 'convergence session identity matches the source session');
    assert.equal(firstConvergence.sessions[0].status, 'calm', 'initial watcher status is calm before evidence concerns');
    assert.match(firstConvergence.sessions[0].summary.goal, /Slice 5/, 'convergence summary infers the opening request');
    assert.equal(firstConvergence.spend.totalCalls, 1, 'first convergence probe spends one cheap judge call');

    await appendFile(
      transcript,
      jsonl([
        rec({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_check', content: 'All checks passed.', is_error: false }] } }),
        rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done — the Cockpit is live.' }] } }),
      ]),
    );

    const second = await adapter.scanOnce(Date.now());
    assert.equal(second.ingestedEvents, 2, 'append scan ingests new live events');

    const retainedIndex = await fetchRunIndex({ limit: 1, scanLimit: 20 });
    assert.ok(retainedIndex.runs.length >= 2, 'fresh session history extends beyond the flat recent run window');

    const replayed = await fetchRecordedEvents({ limit: 1, scanLimit: 20 });
    const views = buildSessionViews(replayed, Date.now());
    assert.equal(views[0].eventCount, 4, 'opening mid-session replays old events plus live append');
    assert.equal(views[0].phase, 'agent response', 'latest append updates phase without restart');

    const convergence = await fetchConvergence({ limit: 1, scanLimit: 20 });
    assert.equal(convergence.sessions[0].status, 'calm', 'successful validation keeps the watcher calm');
    assert.ok(convergence.sessions[0].summary.validation.includes('validation result exited 0'), 'convergence summary retains tool-result validation evidence');
    assert.equal(convergence.spend.totalCalls, firstConvergence.spend.totalCalls, 'rate cap prevents a second judge call during the live append');

    console.log('\nCockpit live check passed.');
    console.log(`  transcript: ${transcript}`);
    console.log(`  runs:       ${(await fetchRunIndex()).runs.map((run) => run.runId).join(', ')}`);
    console.log('  rail:       Claude · loopwatch · slice-5 · active · phase populated');
    console.log('  timeline:   request + validation back-filled, live append streamed via new ingest run');
  } finally {
    await stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
