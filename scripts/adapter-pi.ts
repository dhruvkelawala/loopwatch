/**
 * Pi Source Adapter launcher (issue #11).
 *
 * Runs the adapter as a standalone long-running process that tails Pi
 * (SumoCode) sessions and ingests normalized events into the running Flue
 * server. Start the server first (`pnpm dev`), then run this with
 * `pnpm adapter:pi`.
 *
 * Env overrides:
 *   LOOPWATCH_SERVER_URL   server base URL          (default http://127.0.0.1:3583)
 *   PI_SESSIONS_ROOT       sessions root            (default ~/.pi/agent/sessions)
 *   LOOPWATCH_POLL_MS      poll interval ms         (default 1000)
 *   LOOPWATCH_ANCHOR       'end' | 'start'          (default end — tail new activity only)
 *   LOOPWATCH_IDLE_MS      active → idle threshold  (default 300000)
 *   LOOPWATCH_ENDED_MS     idle → ended threshold   (default 1800000)
 */
import { PiAdapter, httpIngest } from '../src/adapters/pi/adapter.js';
import { DEFAULT_LIVENESS } from '../src/adapters/core/liveness.js';
import { PI_SESSIONS_ROOT } from '../src/adapters/pi/types.js';

/** Parse a non-negative numeric env var, falling back when unset OR malformed (e.g. NaN). */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const serverUrl = process.env.LOOPWATCH_SERVER_URL ?? 'http://127.0.0.1:3583';
const root = process.env.PI_SESSIONS_ROOT ?? PI_SESSIONS_ROOT;
const pollMs = Math.max(1, numEnv('LOOPWATCH_POLL_MS', 1000));
const initialAnchor = process.env.LOOPWATCH_ANCHOR === 'start' ? 'start' : 'end';
const engineToken = process.env.LOOPWATCH_ENGINE_TOKEN;

const adapter = new PiAdapter({
  ingest: httpIngest(serverUrl, { token: engineToken }),
  root,
  initialAnchor,
  thresholds: {
    idleAfterMs: numEnv('LOOPWATCH_IDLE_MS', DEFAULT_LIVENESS.idleAfterMs),
    endedAfterMs: numEnv('LOOPWATCH_ENDED_MS', DEFAULT_LIVENESS.endedAfterMs),
  },
  log: (message, data) => {
    if (data === undefined) console.log(`[pi-adapter] ${message}`);
    else console.log(`[pi-adapter] ${message}`, data);
  },
});

function shutdown() {
  console.log('\n[pi-adapter] stopping…');
  adapter.stop();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[pi-adapter] server=${serverUrl} root=${root}`);
await adapter.runForever({ pollMs });
