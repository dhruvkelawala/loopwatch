import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.LOOPWATCH_FLUE_CHECK_PORT ?? 3587);
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = 'data/flue.db';

/**
 * A normalized event with deliberately unrecognized fields at every level
 * (ADR-0004 / issue #4). These must survive a write → restart → read cycle
 * inside the persisted durable-stream `log` event, proving unknowns are
 * preserved — not stripped — on the round-trip through the file-backed store.
 */
const normalizedEvent = {
  source: 'claude',
  sessionId: 'pi_session_smoke',
  timestamp: '2026-06-21T12:00:00.000Z',
  kind: 'tool_call',
  actor: { type: 'tool', name: 'bash', callId: 'call_42', nestedNative: { pid: 1234 } },
  context: { cwd: '/tmp/repo', gitBranch: 'main' },
  payload: { command: 'rg TODO', exitCode: 0 },
  // Unrecognized top-level fields an adapter might forward.
  sourceNativeFoo: { x: 1 },
  unrecognizedKindHint: 'sentinel',
  'weird.key': 7,
} as const;

type ServerHandle = {
  stop: () => Promise<void>;
};

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/openapi.json`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Flue server did not become ready on ${baseUrl}: ${String(lastError)}`);
}

async function startServer(label: string): Promise<ServerHandle> {
  // This check probes and posts tokenless, so the spawned engine must not
  // inherit a shell-exported LOOPWATCH_ENGINE_TOKEN and start enforcing auth.
  const { LOOPWATCH_ENGINE_TOKEN: _ignoredEngineToken, ...inheritedEnv } = process.env;
  const child = spawn(process.execPath, ['dist/server.mjs'], {
    env: { ...inheritedEnv, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));

  await waitForServer();

  return {
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        delay(5_000).then(() => {
          child.kill('SIGKILL');
        }),
      ]);
    },
  };
}

async function postNormalizedEvent() {
  const response = await fetch(`${baseUrl}/workflows/record-event?wait=result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(normalizedEvent),
  });
  if (!response.ok) {
    throw new Error(`POST /workflows/record-event failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { runId?: string; result?: unknown };
  if (!body.runId) throw new Error(`POST response did not include runId: ${JSON.stringify(body)}`);
  return body.runId;
}

async function readRunMeta(runId: string) {
  const response = await fetch(`${baseUrl}/runs/${runId}?meta`);
  if (!response.ok) {
    throw new Error(`GET /runs/${runId}?meta failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { runId: string; status: string; result?: unknown };
}

interface PersistedEvent {
  type: string;
  eventIndex: number;
  message?: string;
  attributes?: Record<string, unknown>;
}

async function readRunEvents(runId: string) {
  const response = await fetch(`${baseUrl}/runs/${runId}`);
  if (!response.ok) {
    throw new Error(`GET /runs/${runId} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as PersistedEvent[];
}

async function main() {
  rmSync('data', { recursive: true, force: true });
  await mkdir('data', { recursive: true });

  console.log('Building Flue Node server...');
  const build = spawn('pnpm', ['build'], { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    build.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm build exited ${code}`))));
  });

  console.log('Starting server #1...');
  const first = await startServer('server#1');
  const runId = await postNormalizedEvent();
  console.log(`Wrote normalized event: ${runId}`);

  // Read the full stream once before restart to capture exactly what landed in
  // the durable log, so the post-restart assertion compares like-for-like.
  const before = await readRunMeta(runId);
  if (before.status !== 'completed') throw new Error(`Run did not complete before restart: ${before.status}`);
  const eventsBeforeRestart = await readRunEvents(runId);
  await first.stop();
  console.log('Stopped server #1.');

  if (!existsSync(dbPath)) {
    throw new Error(`${dbPath} was not created; src/db.ts is not using file-backed sqlite()`);
  }

  console.log('Starting server #2...');
  const second = await startServer('server#2');
  const after = await readRunMeta(runId);
  const events = await readRunEvents(runId);
  await second.stop();
  console.log('Stopped server #2.');

  if (after.runId !== runId) throw new Error(`Restart returned wrong runId: ${after.runId}`);
  if (after.status !== 'completed') throw new Error(`Restarted run status was not completed: ${after.status}`);
  if (!events.some((event) => event.type === 'run_start')) throw new Error('Persisted stream missing run_start');
  if (!events.some((event) => event.type === 'run_end')) throw new Error('Persisted stream missing run_end');

  // The normalized event must be persisted as a durable-stream log event and
  // must survive restart with every unrecognized field intact (ADR-0004).
  const findRecorded = (rows: PersistedEvent[]) =>
    rows.find((event) => event.type === 'log' && event.message === 'loopwatch.event.recorded');

  const recordedBefore = findRecorded(eventsBeforeRestart);
  const recordedAfter = findRecorded(events);
  if (!recordedBefore) throw new Error('Stream missing loopwatch.event.recorded log event before restart');
  if (!recordedAfter) throw new Error('Restarted stream missing loopwatch.event.recorded log event');

  const assertUnknownsRetained = (label: string, attrs: unknown) => {
    if (!attrs || typeof attrs !== 'object') throw new Error(`${label}: log event attributes missing`);
    const event = attrs as Record<string, unknown>;
    for (const key of ['sourceNativeFoo', 'unrecognizedKindHint', 'weird.key']) {
      if (!(key in event)) throw new Error(`${label}: unknown top-level key "${key}" was stripped`);
    }
    if (!('payload' in event)) throw new Error(`${label}: payload stripped`);
    const actor = event.actor as Record<string, unknown> | undefined;
    if (!actor || !('nestedNative' in actor)) throw new Error(`${label}: nested actor detail stripped`);
  };

  assertUnknownsRetained('pre-restart', recordedBefore.attributes);
  assertUnknownsRetained('post-restart', recordedAfter.attributes);
  assert.deepEqual(recordedAfter.attributes, recordedBefore.attributes, 'round-trip drift across restart');

  console.log('Persistence check passed.');
  console.log(`  database: ${dbPath}`);
  console.log(`  runId:    ${runId}`);
  console.log(`  status:   ${after.status}`);
  console.log(`  events:   ${events.map((event) => `${event.eventIndex}:${event.type}`).join(', ')}`);
  console.log(`  normalized event survived restart with all unknown fields intact.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
