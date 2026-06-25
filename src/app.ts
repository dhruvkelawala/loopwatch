import { getRun, listRuns, type RunPointer } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LoopwatchEventSchema, sessionKey, type LoopwatchEvent } from './events.js';
import { LOOPWATCH_EVENT_WORKFLOWS, LoopwatchRunsQuerySchema } from './schemas/loopwatch.js';

const app = new Hono();

const RUN_LIST_PAGE_SIZE = 500;
const ACTIVE_SESSION_HISTORY_MS = 30 * 60_000;
const runEventCache = new Map<string, LoopwatchEvent[]>();

// The packaged Tauri shell serves the Cockpit UI from a non-HTTP origin, so the
// webview reaches this localhost engine cross-origin. Allow the Tauri webview
// origins; in dev the UI uses the same-origin Vite proxy and needs no CORS.
app.use(
  '*',
  cors({
    origin: ['tauri://localhost', 'http://tauri.localhost'],
    exposeHeaders: ['Stream-Next-Offset', 'Stream-Up-To-Date', 'Stream-Closed', 'Stream-Cursor', 'ETag', 'Location'],
  }),
);

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'loopwatch-flue-engine',
    target: 'node',
  }),
);

/**
 * App-owned inspection endpoint for the Cockpit.
 *
 * Flue intentionally ships no deployment-wide list API in `flue()`; apps build
 * their own operator endpoints from `listRuns()`. The UI uses this run index to
 * replay completed ingest runs once and mount `@flue/react` workflow hooks for
 * active runs, so history back-fills while genuinely live work keeps streaming
 * until close.
 *
 * `limit` is only the recent-run floor. The endpoint scans farther back and
 * retains a fresh Agent Session's earlier ingest runs until it finds the
 * opening user message, which keeps a long Claude session from losing its title
 * and request context just because the adapter has produced many 1s batches.
 */
app.get('/loopwatch/runs', async (c) => {
  const parsed = LoopwatchRunsQuerySchema.safeParse({
    limit: c.req.query('limit') ?? undefined,
    scanLimit: c.req.query('scanLimit') ?? undefined,
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const runs = await buildLoopwatchRunIndex(parsed.data.limit, parsed.data.scanLimit);

  return c.json({ ok: true, runs, nextPollMs: 1000 });
});

app.route('/', flue());

async function buildLoopwatchRunIndex(limit: number, scanLimit: number): Promise<RunPointer[]> {
  const scannedRuns = await listLoopwatchRuns(Math.max(limit, scanLimit));
  const indexedRuns = await retainRecentAndFreshSessionRuns(scannedRuns, limit, Date.now());
  pruneRunEventCache(scannedRuns);
  return indexedRuns;
}

async function listLoopwatchRuns(scanLimit: number): Promise<RunPointer[]> {
  const workflowRuns = await Promise.all(LOOPWATCH_EVENT_WORKFLOWS.map((workflowName) => listWorkflowRuns(workflowName, scanLimit)));
  return workflowRuns.flatMap((response) => response).sort(compareRunPointersDesc).slice(0, scanLimit);
}

async function listWorkflowRuns(workflowName: string, scanLimit: number): Promise<RunPointer[]> {
  const runs: RunPointer[] = [];
  let cursor: string | undefined;

  while (runs.length < scanLimit) {
    const page = await listRuns({ workflowName, limit: Math.min(RUN_LIST_PAGE_SIZE, scanLimit - runs.length), cursor });
    runs.push(...page.runs);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return runs;
}

async function retainRecentAndFreshSessionRuns(runs: RunPointer[], limit: number, nowMs: number): Promise<RunPointer[]> {
  const recentRuns = runs.slice(0, limit);
  const retainedRunIds = new Set(recentRuns.map((run) => run.runId));
  const freshSessions = new Map<string, { hasOpeningRequest: boolean }>();

  const recentRunEvents = await Promise.all(recentRuns.map(async (run) => [run, await recordedEventsForRun(run)] as const));
  for (const [, events] of recentRunEvents) {
    for (const event of events) {
      if (!eventIsFresh(event, nowMs)) continue;
      const key = sessionKey(event);
      const summary = freshSessions.get(key) ?? { hasOpeningRequest: false };
      summary.hasOpeningRequest ||= isOpeningUserMessage(event);
      freshSessions.set(key, summary);
    }
  }

  if (freshSessions.size === 0) return recentRuns;

  for (const run of runs.slice(limit)) {
    const events = await recordedEventsForRun(run);
    let retained = false;

    for (const event of events) {
      const summary = freshSessions.get(sessionKey(event));
      if (!summary) continue;
      retained = true;
      summary.hasOpeningRequest ||= isOpeningUserMessage(event);
    }

    if (retained) retainedRunIds.add(run.runId);
    if ([...freshSessions.values()].every((summary) => summary.hasOpeningRequest)) break;
  }

  return runs.filter((run) => retainedRunIds.has(run.runId));
}

async function recordedEventsForRun(pointer: RunPointer): Promise<LoopwatchEvent[]> {
  if (pointer.status !== 'active') {
    const cached = runEventCache.get(pointer.runId);
    if (cached) return cached;
  }

  const run = await getRun(pointer.runId);
  const events = loopwatchEventsFromResult(run?.result);
  if (pointer.status !== 'active') runEventCache.set(pointer.runId, events);
  return events;
}

function pruneRunEventCache(scannedRuns: RunPointer[]): void {
  const liveRunIds = new Set(scannedRuns.map((run) => run.runId));
  for (const runId of runEventCache.keys()) {
    if (!liveRunIds.has(runId)) runEventCache.delete(runId);
  }
}

function loopwatchEventsFromResult(result: unknown): LoopwatchEvent[] {
  const record = recordValue(result);
  const candidates = Array.isArray(record?.events) ? record.events : [result];

  return candidates.flatMap((candidate) => {
    const parsed = LoopwatchEventSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function eventIsFresh(event: LoopwatchEvent, nowMs: number): boolean {
  const timestamp = Date.parse(event.timestamp);
  return Number.isFinite(timestamp) && nowMs - timestamp < ACTIVE_SESSION_HISTORY_MS;
}

function isOpeningUserMessage(event: LoopwatchEvent): boolean {
  return event.kind === 'message' && event.actor.type === 'user';
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function compareRunPointersDesc(a: RunPointer, b: RunPointer): number {
  const byStartedAt = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (byStartedAt !== 0) return byStartedAt;
  return b.runId.localeCompare(a.runId);
}

export default app;
