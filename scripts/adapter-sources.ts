/**
 * Multi-source adapter launcher for Loopwatch v1.
 *
 * Starts the passive Level 1 JSONL adapters for Claude, Codex, and Pi and
 * ingests normalized events into the local Flue Node engine.
 */
import { ClaudeAdapter } from '../src/adapters/claude/adapter.js';
import { DEFAULT_LIVENESS } from '../src/adapters/claude/liveness.js';
import { CLAUDE_PROJECTS_ROOT } from '../src/adapters/claude/types.js';
import { CodexAdapter } from '../src/adapters/codex/adapter.js';
import { CODEX_SESSIONS_ROOT } from '../src/adapters/codex/types.js';
import { httpIngest } from '../src/adapters/core/tailing-adapter.js';
import { PiAdapter } from '../src/adapters/pi/adapter.js';
import { PI_SESSIONS_ROOT } from '../src/adapters/pi/types.js';

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sourceEnabled(name: string): boolean {
  const raw = process.env[`LOOPWATCH_${name.toUpperCase()}_ADAPTER`];
  if (raw === undefined) return true;
  return !['0', 'false', 'off', 'no'].includes(raw.toLowerCase());
}

const serverUrl = process.env.LOOPWATCH_SERVER_URL ?? 'http://127.0.0.1:3583';
const pollMs = Math.max(1, numEnv('LOOPWATCH_POLL_MS', 1000));
const initialAnchor = process.env.LOOPWATCH_ANCHOR === 'start' ? 'start' : 'end';
const engineToken = process.env.LOOPWATCH_ENGINE_TOKEN;
const ingest = httpIngest(serverUrl, { token: engineToken });
const thresholds = {
  idleAfterMs: numEnv('LOOPWATCH_IDLE_MS', DEFAULT_LIVENESS.idleAfterMs),
  endedAfterMs: numEnv('LOOPWATCH_ENDED_MS', DEFAULT_LIVENESS.endedAfterMs),
};

const adapters = [
  sourceEnabled('claude')
    ? new ClaudeAdapter({
        ingest,
        root: process.env.CLAUDE_PROJECTS_ROOT ?? CLAUDE_PROJECTS_ROOT,
        initialAnchor,
        thresholds,
        log: (message, data) => console.log(data === undefined ? `[claude-adapter] ${message}` : `[claude-adapter] ${message}`, data ?? ''),
      })
    : undefined,
  sourceEnabled('codex')
    ? new CodexAdapter({
        ingest,
        root: process.env.CODEX_SESSIONS_ROOT ?? CODEX_SESSIONS_ROOT,
        initialAnchor,
        thresholds,
        log: (message, data) => console.log(data === undefined ? `[codex-adapter] ${message}` : `[codex-adapter] ${message}`, data ?? ''),
      })
    : undefined,
  sourceEnabled('pi')
    ? new PiAdapter({
        ingest,
        root: process.env.PI_SESSIONS_ROOT ?? PI_SESSIONS_ROOT,
        initialAnchor,
        thresholds,
        log: (message, data) => console.log(data === undefined ? `[pi-adapter] ${message}` : `[pi-adapter] ${message}`, data ?? ''),
      })
    : undefined,
].filter((adapter): adapter is ClaudeAdapter | CodexAdapter | PiAdapter => adapter !== undefined);

function shutdown() {
  console.log('\n[source-adapters] stopping…');
  for (const adapter of adapters) adapter.stop();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[source-adapters] server=${serverUrl} sources=${adapters.length} poll=${pollMs}ms anchor=${initialAnchor}`);
if (adapters.length === 0) {
  // Stay alive with zero enabled sources: the Tauri launcher treats an early
  // child exit as a failed launch and tears the whole app down, and disabling
  // every source individually is a legitimate diagnostic configuration.
  console.log('[source-adapters] all sources disabled; supervisor idling');
  // A pending promise alone does not keep Node alive — hold an event-loop
  // handle so the process idles until the launcher's SIGTERM.
  setInterval(() => {}, 60_000);
  await new Promise(() => {});
}
await Promise.all(adapters.map((adapter) => adapter.runForever({ pollMs })));
