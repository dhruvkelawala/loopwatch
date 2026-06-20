import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.LOOPWATCH_FLUE_CHECK_PORT ?? 3587);
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = 'data/flue.db';

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
  const child = spawn(process.execPath, ['dist/server.mjs'], {
    env: { ...process.env, PORT: String(port) },
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

async function postProbeEvent() {
  const response = await fetch(`${baseUrl}/workflows/record-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: `persistence check ${new Date().toISOString()}` }),
  });
  if (!response.ok) {
    throw new Error(`POST /workflows/record-event failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { runId?: string };
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

async function readRunEvents(runId: string) {
  const response = await fetch(`${baseUrl}/runs/${runId}`);
  if (!response.ok) {
    throw new Error(`GET /runs/${runId} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as Array<{ type: string; eventIndex: number }>;
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
  const runId = await postProbeEvent();
  console.log(`Wrote workflow event: ${runId}`);

  // The workflow is intentionally synchronous, but read once before restart to
  // ensure Flue completed and persisted both run metadata and event-stream rows.
  const before = await readRunMeta(runId);
  if (before.status !== 'completed') throw new Error(`Run did not complete before restart: ${before.status}`);
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

  console.log('Persistence check passed.');
  console.log(`  database: ${dbPath}`);
  console.log(`  runId:    ${runId}`);
  console.log(`  status:   ${after.status}`);
  console.log(`  events:   ${events.map((event) => `${event.eventIndex}:${event.type}`).join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
