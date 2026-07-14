/**
 * Claude Code Source Adapter launcher (issue #5).
 *
 * Runs the adapter as a standalone long-running process that tails Claude
 * transcripts and ingests normalized events into the running Flue server.
 * Start the server first (`pnpm dev`), then run this with `pnpm adapter:claude`.
 *
 * Env overrides:
 *   LOOPWATCH_SERVER_URL   server base URL          (default http://127.0.0.1:3583)
 *   LOOPWATCH_ENGINE_TOKEN bearer token for secured engine requests (optional)
 *   CLAUDE_PROJECTS_ROOT   transcript root          (default ~/.claude/projects)
 *   LOOPWATCH_POLL_MS      poll interval ms         (default 1000)
 *   LOOPWATCH_ANCHOR       'end' | 'start'          (default end — tail new activity only)
 *   LOOPWATCH_IDLE_MS      active → idle threshold  (default 300000)
 *   LOOPWATCH_ENDED_MS     idle → ended threshold   (default 1800000)
 */
import { ClaudeAdapter, httpIngest } from '../src/adapters/claude/adapter.js';
import { DEFAULT_LIVENESS } from '../src/adapters/claude/liveness.js';
import { CLAUDE_PROJECTS_ROOT } from '../src/adapters/claude/types.js';

/** Parse a non-negative numeric env var, falling back when unset OR malformed (e.g. NaN). */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const serverUrl = process.env.LOOPWATCH_SERVER_URL ?? 'http://127.0.0.1:3583';
const root = process.env.CLAUDE_PROJECTS_ROOT ?? CLAUDE_PROJECTS_ROOT;
const pollMs = Math.max(1, numEnv('LOOPWATCH_POLL_MS', 1000));
const initialAnchor = process.env.LOOPWATCH_ANCHOR === 'start' ? 'start' : 'end';

const engineToken = process.env.LOOPWATCH_ENGINE_TOKEN;

const adapter = new ClaudeAdapter({
  ingest: httpIngest(serverUrl, { token: engineToken }),
  root,
  initialAnchor,
  thresholds: {
    idleAfterMs: numEnv('LOOPWATCH_IDLE_MS', DEFAULT_LIVENESS.idleAfterMs),
    endedAfterMs: numEnv('LOOPWATCH_ENDED_MS', DEFAULT_LIVENESS.endedAfterMs),
  },
  log: (message, data) => {
    if (data === undefined) console.log(`[claude-adapter] ${message}`);
    else console.log(`[claude-adapter] ${message}`, data);
  },
});

function shutdown() {
  console.log('\n[claude-adapter] stopping…');
  adapter.stop();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[claude-adapter] server=${serverUrl} root=${root}`);
await adapter.runForever({ pollMs });
