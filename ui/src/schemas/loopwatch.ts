import { z } from 'zod';

export const EngineHealthSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  target: z.string(),
});
export type EngineHealth = z.infer<typeof EngineHealthSchema>;

export const ActorSchema = z.looseObject({
  type: z.enum(['user', 'agent', 'tool', 'system']),
});

export const EventContextSchema = z.looseObject({
  cwd: z.string().optional(),
  repo: z.string().optional(),
  gitBranch: z.string().optional(),
});

export const LoopwatchEventSchema = z.looseObject({
  source: z.string().min(1),
  sessionId: z.string().min(1),
  timestamp: z.string(),
  kind: z.string().min(1),
  actor: ActorSchema,
  context: EventContextSchema.optional(),
  payload: z.unknown().optional(),
});
export type LoopwatchEvent = z.infer<typeof LoopwatchEventSchema>;

export const LoopwatchRunPointerSchema = z.object({
  runId: z.string(),
  workflowName: z.string(),
  status: z.enum(['active', 'completed', 'errored']),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  isError: z.boolean().optional(),
});
export type LoopwatchRunPointer = z.infer<typeof LoopwatchRunPointerSchema>;

export const LoopwatchRunsResponseSchema = z.object({
  ok: z.literal(true),
  runs: z.array(LoopwatchRunPointerSchema),
  nextPollMs: z.number().int().positive().optional(),
});

export const ConvergenceStatusSchema = z.enum(['calm', 'watch', 'intervention']);

export const ConvergenceEvidenceRefSchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.string(),
  kind: z.string().min(1),
  severity: ConvergenceStatusSchema,
  signal: z.enum(['drift', 'burn', 'weak_validation', 'churn', 'completion_without_evidence']),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendedAction: z.string().min(1).optional(),
});

export const RunningSummarySchema = z.object({
  goal: z.string().min(1),
  done: z.array(z.string()),
  validation: z.array(z.string()),
  concerns: z.array(z.string()),
});

export const ConvergenceSpendSchema = z.object({
  cheapCalls: z.number().int().nonnegative(),
  strongCalls: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type ConvergenceSpend = z.infer<typeof ConvergenceSpendSchema>;

export const GitEvidenceSnapshotSchema = z.object({
  repoRoot: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  dirty: z.boolean(),
  changedFiles: z.array(z.string()),
  diff: z.object({
    files: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }),
  head: z
    .object({
      sha: z.string().min(1),
      subject: z.string().min(1),
      committedAt: z.string().min(1),
    })
    .optional(),
  validation: z.object({
    status: z.enum(['passed', 'failed', 'unknown']),
    detail: z.string().min(1),
    eventId: z.string().optional(),
  }),
  sampledAt: z.string().min(1),
});
export type GitEvidenceSnapshot = z.infer<typeof GitEvidenceSnapshotSchema>;

export const SessionConvergenceSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sessionId: z.string().min(1),
  status: ConvergenceStatusSchema,
  liveness: z.enum(['active', 'idle', 'ended']),
  summary: RunningSummarySchema,
  evidence: z.array(ConvergenceEvidenceRefSchema),
  judge: z.object({
    provider: z.literal('deterministic-fake-v1'),
    lastTier: z.enum(['cheap', 'strong']).optional(),
    lastRunAt: z.string().optional(),
    nextEligibleAt: z.string().optional(),
    lastReason: z.string().optional(),
    rateCapMs: z.number().int().positive(),
  }),
  spend: ConvergenceSpendSchema,
  eventCount: z.number().int().nonnegative(),
  meaningfulEventCount: z.number().int().nonnegative(),
  lastEventAt: z.string(),
  git: GitEvidenceSnapshotSchema.optional(),
});
export type SessionConvergence = z.infer<typeof SessionConvergenceSchema>;

export const LoopwatchConvergenceResponseSchema = z.object({
  ok: z.literal(true),
  sessions: z.array(SessionConvergenceSchema),
  spend: ConvergenceSpendSchema,
  nextPollMs: z.number().int().positive(),
});
export type LoopwatchConvergenceResponse = z.infer<typeof LoopwatchConvergenceResponseSchema>;
