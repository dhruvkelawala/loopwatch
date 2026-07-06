/**
 * Integration test for the Claude adapter → store path (issue #5).
 *
 * Boots the real Flue server, points the adapter at a fixture transcript, and
 * proves end-to-end that:
 *   - tailed records are emitted as normalized events into the durable store
 *     (via the batch `record-events` workflow), with identity + context intact;
 *   - new appends to the transcript appear as new store events without a
 *     server restart.
 *
 * Run with: pnpm ingest:check
 */
import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ClaudeAdapter, type IngestFn } from '../src/adapters/claude/adapter.js';

const port = Number(process.env.LOOPWATCH_INGEST_CHECK_PORT ?? 3588);
const baseUrl = `http://127.0.0.1:${port}`;
const SID = 'integration-7564ccd3-db65-438f-a828-1b59cb6489b7';

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/openapi.json`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Flue server not ready on ${baseUrl}: ${String(lastError)}`);
}

async function startServer() {
  // This check probes and posts tokenless, so the spawned engine must not
  // inherit a shell-exported LOOPWATCH_ENGINE_TOKEN and start enforcing auth.
  const { LOOPWATCH_ENGINE_TOKEN: _ignoredEngineToken, ...inheritedEnv } = process.env;
  const child = spawn(process.execPath, ['dist/server.mjs'], {
    env: { ...inheritedEnv, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => process.stdout.write(`[server] ${c}`));
  child.stderr.on('data', (c) => process.stderr.write(`[server] ${c}`));
  await waitForServer();
  return async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(5000).then(() => child.kill('SIGKILL')),
    ]);
  };
}

interface PersistedEvent {
  type: string;
  message?: string;
  attributes?: Record<string, unknown>;
}

async function recordedEventsFor(runId: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${baseUrl}/runs/${runId}`);
  if (!response.ok) throw new Error(`GET /runs/${runId} failed: ${response.status}`);
  const events = (await response.json()) as PersistedEvent[];
  return events
    .filter((e) => e.type === 'log' && e.message === 'loopwatch.event.recorded')
    .map((e) => e.attributes as Record<string, unknown>);
}

let uuidN = 0;
function rec(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: SID,
    uuid: `int-uuid-${++uuidN}`,
    timestamp: '2026-06-21T12:00:00.000Z',
    cwd: '/Users/d/dev/loopwatch',
    gitBranch: 'main',
    version: '2.1.170',
    ...extra,
  };
}
const jsonl = (records: Record<string, unknown>[]) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Numeric equality that takes values (no control-flow narrowing of mutated counters). */
function eq(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

async function main() {
  await rm('data', { recursive: true, force: true });
  await mkdir('data', { recursive: true });

  console.log('Building Flue Node server...');
  await new Promise<void>((resolve, reject) => {
    spawn('pnpm', ['build'], { stdio: 'inherit' }).once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`build exited ${code}`)),
    );
  });

  // Fixture transcript.
  const dir = await mkdtemp(join(tmpdir(), 'lw-ingest-'));
  const root = join(dir, 'projects');
  const projectDir = join(root, '-Users-d-dev-loopwatch');
  const transcript = join(projectDir, `${SID}.jsonl`);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    transcript,
    jsonl([
      rec({ type: 'user', message: { role: 'user', content: 'kick off the task' } }),
      rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } }),
    ]),
  );

  console.log('Starting server...');
  const stop = await startServer();
  try {
    // Adapter ingest that captures each batch's runId so we can read the store back.
    const runIds: string[] = [];
    const ingest: IngestFn = async (events) => {
      const response = await fetch(`${baseUrl}/workflows/record-events?wait=result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) throw new Error(`record-events failed: ${response.status} ${await response.text()}`);
      const body = (await response.json()) as { runId?: string };
      if (body.runId) runIds.push(body.runId);
    };

    const adapter = new ClaudeAdapter({ ingest, root, cursorDir: join(dir, 'cursors'), initialAnchor: 'start' });

    const first = await adapter.scanOnce();
    eq(first.ingestedEvents, 2, 'first scan ingested');
    eq(runIds.length, 1, 'batch runs after first scan');

    const stored = await recordedEventsFor(runIds[0]);
    eq(stored.length, 2, 'stored events after first scan');
    assert(stored.every((e) => e.source === 'claude'), 'every stored event has source=claude');
    assert(stored.every((e) => e.sessionId === SID), 'every stored event carries the source session id');
    assert(stored.map((e) => e.kind).join(',') === 'message,tool_call', `kinds were ${stored.map((e) => e.kind).join(',')}`);
    const ctx0 = stored[0].context as Record<string, unknown>;
    assert(ctx0?.cwd === '/Users/d/dev/loopwatch' && ctx0?.gitBranch === 'main', 'context (cwd/gitBranch) is captured');

    // Live append — no server restart, no adapter restart.
    await appendFile(transcript, jsonl([rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } })]));
    const second = await adapter.scanOnce();
    eq(second.ingestedEvents, 1, 'append scan ingested');
    eq(runIds.length, 2, 'batch runs after append');
    const appended = await recordedEventsFor(runIds[1]);
    eq(appended.length, 1, 'appended store events');
    assert(appended[0].kind === 'message', 'appended event reached the store as a new event');

    console.log('\nClaude ingest check passed.');
    console.log(`  transcript: ${transcript}`);
    console.log(`  batches:    ${runIds.length} (runIds ${runIds.join(', ')})`);
    console.log('  identity (claude, sessionId) + cwd/gitBranch context persisted; live append surfaced without restart.');
  } finally {
    await stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
