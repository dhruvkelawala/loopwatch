import { getRun, invoke, type RunRecord } from '@flue/runtime';
import { expandHome, readAuthStatus } from 'flue-codex-oauth';

import { buildEvidencePacket } from './evidence-packet.js';
import type { ConvergenceEvidenceRef, ConvergenceSnapshot, ConvergenceSpend, SessionConvergenceState } from './convergence.js';
import type { LoopwatchEvent } from './events.js';
import judgeConvergenceWorkflow from './workflows/judge-convergence.js';

export type ModelJudgeMode = 'deterministic' | 'model';

interface ModelJudgeOptions {
  mode?: ModelJudgeMode;
  model?: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  timeoutMs?: number;
  pollMs?: number;
}

interface ModelJudgeWorkflowResult {
  status: SessionConvergenceState['status'];
  evidence: ConvergenceEvidenceRef[];
  reason: string;
  model: string;
  usage?: {
    totalTokens?: number;
    cost?: { total?: number };
  };
}

interface ModelJudgeCacheEntry {
  key: string;
  result?: ModelJudgeWorkflowResult;
  error?: string;
}

const DEFAULT_MODEL_JUDGE_TIMEOUT_MS = 45_000;
const DEFAULT_MODEL_JUDGE_POLL_MS = 250;
const modelJudgeCache = new Map<string, ModelJudgeCacheEntry>();

export function modelJudgeOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ModelJudgeOptions {
  return {
    mode: env.LOOPWATCH_CONVERGENCE_JUDGE === 'model' ? 'model' : 'deterministic',
    model: env.LOOPWATCH_JUDGE_MODEL ?? 'openai-codex/gpt-5.5',
    thinkingLevel: thinkingLevelFromEnv(env.LOOPWATCH_JUDGE_THINKING),
    timeoutMs: positiveIntEnv(env.LOOPWATCH_JUDGE_TIMEOUT_MS) ?? DEFAULT_MODEL_JUDGE_TIMEOUT_MS,
  };
}

export async function applyModelJudges(
  snapshot: ConvergenceSnapshot,
  events: readonly LoopwatchEvent[],
  options: ModelJudgeOptions = {},
): Promise<ConvergenceSnapshot> {
  if ((options.mode ?? 'deterministic') !== 'model') return snapshot;

  const model = options.model ?? 'openai-codex/gpt-5.5';
  const sessions = await Promise.all(
    snapshot.sessions.map((session) => applyModelJudge(session, events, {
      model,
      thinkingLevel: options.thinkingLevel,
      timeoutMs: options.timeoutMs ?? DEFAULT_MODEL_JUDGE_TIMEOUT_MS,
      pollMs: options.pollMs ?? DEFAULT_MODEL_JUDGE_POLL_MS,
    })),
  );

  return {
    ...snapshot,
    sessions,
    spend: sumSpend(sessions.map((session) => session.spend)),
  };
}

async function applyModelJudge(
  session: SessionConvergenceState,
  events: readonly LoopwatchEvent[],
  options: Required<Pick<ModelJudgeOptions, 'model' | 'timeoutMs' | 'pollMs'>> & Pick<ModelJudgeOptions, 'thinkingLevel'>,
): Promise<SessionConvergenceState> {
  if (session.liveness !== 'active' || !session.judge.lastRunAt) return session;

  const key = `${session.id}:${session.judge.lastRunAt}:${options.model}`;
  const configured = modelConfigured(options.model);
  if (configured !== undefined) return mergeModelError(session, options.model, configured);

  const cached = modelJudgeCache.get(key);
  if (cached?.result) return mergeModelResult(session, cached.result);
  if (cached?.error) return mergeModelError(session, options.model, cached.error);

  try {
    const packet = buildEvidencePacket({
      session,
      summary: session.summary,
      evidence: session.evidence,
      events: events.filter((event) => `${event.source}:${event.sessionId}` === session.id),
      deepAnalyzeConsent: false,
    });
    const receipt = await invoke(judgeConvergenceWorkflow, {
      input: {
        packet,
        model: options.model,
        ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      },
    });
    const run = await waitForRun(receipt.runId, options.timeoutMs, options.pollMs);
    const result = parseModelJudgeResult(run.result);
    modelJudgeCache.set(key, { key, result });
    return mergeModelResult(session, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    modelJudgeCache.set(key, { key, error: message });
    return mergeModelError(session, options.model, message);
  }
}

async function waitForRun(runId: string, timeoutMs: number, pollMs: number): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const run = await getRun(runId);
    if (run?.status === 'completed') return run;
    if (run?.status === 'errored') throw new Error(`judge workflow errored: ${JSON.stringify(run.error)}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`judge workflow timed out after ${timeoutMs}ms`);
}

function parseModelJudgeResult(value: unknown): ModelJudgeWorkflowResult {
  if (!isRecord(value)) throw new Error('judge workflow returned a non-object result');
  const status = value.status;
  const reason = value.reason;
  const model = value.model;
  if (status !== 'calm' && status !== 'watch' && status !== 'intervention') throw new Error('judge workflow returned invalid status');
  if (typeof reason !== 'string') throw new Error('judge workflow returned invalid reason');
  if (typeof model !== 'string' || model.length === 0) throw new Error('judge workflow returned invalid model');
  const evidence = Array.isArray(value.evidence) ? value.evidence.filter(isEvidenceRef) : [];
  const usage = isRecord(value.usage) ? {
    totalTokens: typeof value.usage.totalTokens === 'number' ? value.usage.totalTokens : undefined,
    cost: isRecord(value.usage.cost) ? { total: typeof value.usage.cost.total === 'number' ? value.usage.cost.total : undefined } : undefined,
  } : undefined;
  return { status, reason, model, evidence, usage };
}

function mergeModelResult(session: SessionConvergenceState, result: ModelJudgeWorkflowResult): SessionConvergenceState {
  const modelSpend: ConvergenceSpend = {
    cheapCalls: session.spend.cheapCalls,
    strongCalls: session.spend.strongCalls + 1,
    totalCalls: session.spend.totalCalls + 1,
    estimatedTokens: session.spend.estimatedTokens + Math.max(0, Math.round(result.usage?.totalTokens ?? 0)),
    estimatedCostUsd: roundUsd(session.spend.estimatedCostUsd + Math.max(0, result.usage?.cost?.total ?? 0)),
  };
  return {
    ...session,
    status: result.status,
    evidence: result.evidence,
    summary: { ...session.summary, concerns: result.evidence.map((item) => item.title).slice(0, 5) },
    judge: {
      ...session.judge,
      provider: result.model,
      lastTier: 'strong',
      lastReason: result.reason,
    },
    spend: modelSpend,
  };
}

function mergeModelError(session: SessionConvergenceState, model: string, message: string): SessionConvergenceState {
  return {
    ...session,
    judge: {
      ...session.judge,
      provider: `${model} (unavailable; deterministic fallback)`,
      lastReason: `model judge unavailable: ${message}`,
    },
  };
}

function modelConfigured(model: string): string | undefined {
  if (!model.startsWith('openai-codex/')) return undefined;
  const status = readAuthStatus({ authPath: expandHome(process.env.FLUE_CODEX_AUTH_PATH ?? '~/.flue/openai-codex.json') });
  return status.configured ? undefined : `Codex OAuth auth file is missing at ${status.authPath}`;
}

function isEvidenceRef(value: unknown): value is ConvergenceEvidenceRef {
  if (!isRecord(value)) return false;
  return typeof value.eventId === 'string'
    && typeof value.timestamp === 'string'
    && typeof value.kind === 'string'
    && (value.severity === 'calm' || value.severity === 'watch' || value.severity === 'intervention')
    && (value.signal === 'drift' || value.signal === 'burn' || value.signal === 'weak_validation' || value.signal === 'churn' || value.signal === 'completion_without_evidence')
    && typeof value.title === 'string'
    && typeof value.detail === 'string';
}

function sumSpend(spends: readonly ConvergenceSpend[]): ConvergenceSpend {
  return spends.reduce(
    (total, spend) => ({
      cheapCalls: total.cheapCalls + spend.cheapCalls,
      strongCalls: total.strongCalls + spend.strongCalls,
      totalCalls: total.totalCalls + spend.totalCalls,
      estimatedTokens: total.estimatedTokens + spend.estimatedTokens,
      estimatedCostUsd: roundUsd(total.estimatedCostUsd + spend.estimatedCostUsd),
    }),
    { cheapCalls: 0, strongCalls: 0, totalCalls: 0, estimatedTokens: 0, estimatedCostUsd: 0 },
  );
}

function thinkingLevelFromEnv(value: string | undefined): ModelJudgeOptions['thinkingLevel'] {
  if (value === 'off' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return 'low';
}

function positiveIntEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
