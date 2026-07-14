import { timingSafeEqual } from 'node:crypto';
import { getRun, listRuns, type RunPointer } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { configureLoopwatchCodexOAuth, createLoopwatchCodexOAuthIntegration, loopwatchCodexOAuthSnapshot } from './codex-oauth.js';
import { buildConvergenceSnapshot, convergenceConfigFromEnv } from './convergence.js';
import { buildScopedGitEvidenceEvents } from './git-watch.js';
import { addUserLoop, loadLoopLibrary, LoopSchema, recommendLoopFromLibrary } from './loops.js';
import { LoopwatchEventSchema, sessionKey, type LoopwatchEvent } from './events.js';
import { applyModelJudges, modelJudgeOptionsFromEnv } from './model-judge.js';
import { LOOPWATCH_EVENT_WORKFLOWS, LoopwatchConvergenceQuerySchema, LoopwatchLoopRecommendationQuerySchema, LoopwatchRunsQuerySchema } from './schemas/loopwatch.js';

const app = new Hono();

const RUN_LIST_PAGE_SIZE = 500;
const ACTIVE_SESSION_HISTORY_MS = 30 * 60_000;
const ENGINE_EXPOSED_HEADERS = ['Stream-Next-Offset', 'Stream-Up-To-Date', 'Stream-Closed', 'Stream-Cursor', 'ETag', 'Location'];
const DEFAULT_ENGINE_ALLOWED_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'http://127.0.0.1:1420', 'http://localhost:1420'];
const LOOPBACK_HOSTS: Record<string, true> = { '127.0.0.1': true, localhost: true };
const runEventCache = new Map<string, LoopwatchEvent[]>();
const codexOAuth = createLoopwatchCodexOAuthIntegration();
await configureLoopwatchCodexOAuth(codexOAuth);

// Issue #22: the local engine is private session state. Keep the unauthenticated
// dev mode for existing scripts, but when the Tauri launcher supplies a per-run
// token every route (including mounted Flue routes) must pass Host/Origin and
// bearer-token checks before the router observes it.
app.use('*', enforceEngineBoundary);

app.use(
  '*',
  cors({
    origin: (origin) => (isAllowedEngineOrigin(origin) ? origin : ''),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: ENGINE_EXPOSED_HEADERS,
  }),
);

if (codexOAuth.enabled) {
  app.use('*', codexOAuth.auth.middleware() as MiddlewareHandler);
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'loopwatch-flue-engine',
    target: 'node',
  }),
);

app.get('/loopwatch/codex-auth', (c) => c.json({ ok: true, ...loopwatchCodexOAuthSnapshot(codexOAuth) }));

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

app.get('/loopwatch/convergence', async (c) => {
  const parsed = LoopwatchConvergenceQuerySchema.safeParse({
    limit: c.req.query('limit') ?? undefined,
    scanLimit: c.req.query('scanLimit') ?? undefined,
    pivotMode: c.req.query('pivotMode') ?? undefined,
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const config = convergenceConfigFromEnv();
  const nowMs = Date.now();
  const runs = await buildLoopwatchRunIndex(parsed.data.limit, parsed.data.scanLimit);
  const eventGroups = await Promise.all(runs.map((run) => recordedEventsForRun(run)));
  const recordedEvents = eventGroups.flat();
  const gitEvents = await buildScopedGitEvidenceEvents(recordedEvents, { nowMs, activeAfterMs: config.idleAfterMs, cacheTtlMs: 1_500 });
  const library = await loadLoopLibrary();
  const snapshot = buildConvergenceSnapshot([...recordedEvents, ...gitEvents], { ...config, pivotMode: parsed.data.pivotMode ?? config.pivotMode, nowMs, loopAnchoring: { loops: library.loops } });
  const judgedSnapshot = await applyModelJudges(snapshot, [...recordedEvents, ...gitEvents], modelJudgeOptionsFromEnv());

  return c.json({ ok: true, ...judgedSnapshot });
});

app.get('/loopwatch/loops', async (c) => {
  const library = await loadLoopLibrary();
  return c.json(library);
});

app.get('/loopwatch/loops/recommend', async (c) => {
  const parsed = LoopwatchLoopRecommendationQuerySchema.safeParse({
    task: c.req.query('task') ?? undefined,
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const recommendation = await recommendLoopFromLibrary(parsed.data.task);
  return c.json(recommendation);
});

app.post('/loopwatch/loops', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_request' }, 400);
  }

  const parsed = LoopSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const loop = await addUserLoop(parsed.data);
  return c.json({ ok: true, loop }, 201);
});

app.route('/', flue());

async function enforceEngineBoundary(c: Parameters<MiddlewareHandler>[0], next: Parameters<MiddlewareHandler>[1]): Promise<Response | void> {
  const host = requestAuthority(c.req.raw);
  if (!isAllowedEngineHost(host)) {
    return c.json({ ok: false, error: 'forbidden_host' }, 403);
  }

  const origin = c.req.header('origin');
  if (origin !== undefined && !isAllowedEngineOrigin(origin)) {
    return c.json({ ok: false, error: 'forbidden_origin' }, 403);
  }

  const token = configuredEngineToken();
  if (token !== undefined && c.req.method !== 'OPTIONS' && !authorizationMatches(c.req.header('authorization'), token)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  await next();
}

function requestAuthority(request: Request): string {
  return request.headers.get('host') ?? new URL(request.url).host;
}

function isAllowedEngineHost(authority: string): boolean {
  const normalized = normalizeAuthority(authority);
  const configuredHosts = csvEnv('LOOPWATCH_ENGINE_ALLOWED_HOSTS').map(normalizeAuthority);
  if (configuredHosts.length > 0) return configuredHosts.includes(normalized);

  const parsed = parseAuthority(normalized);
  return parsed !== undefined && LOOPBACK_HOSTS[parsed.hostname] === true && parsed.port === expectedEnginePort();
}

function parseAuthority(authority: string): { hostname: string; port: string } | undefined {
  try {
    const url = new URL(`http://${authority}`);
    return {
      hostname: url.hostname.replace(/\.$/, '').toLowerCase(),
      port: url.port,
    };
  } catch {
    return undefined;
  }
}

function expectedEnginePort(): string {
  return process.env.PORT ?? process.env.LOOPWATCH_ENGINE_PORT ?? '3000';
}

function normalizeAuthority(authority: string): string {
  return authority.trim().toLowerCase().replace(/\.$/, '');
}

function isAllowedEngineOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (normalized === undefined) return false;
  return [...DEFAULT_ENGINE_ALLOWED_ORIGINS, ...csvEnv('LOOPWATCH_ENGINE_ALLOWED_ORIGINS')].includes(normalized);
}

function normalizeOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return undefined;
  }
}

function configuredEngineToken(): string | undefined {
  const token = process.env.LOOPWATCH_ENGINE_TOKEN?.trim();
  return token ? token : undefined;
}

function authorizationMatches(authorization: string | undefined, token: string): boolean {
  return constantTimeEqual(authorization ?? '', `Bearer ${token}`);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

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
