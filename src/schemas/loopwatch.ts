import { z } from 'zod';

export const LOOPWATCH_EVENT_WORKFLOWS = ['record-events', 'record-event'] as const;

export const LoopwatchRunsQuerySchema = z.object({
  // Recent run window returned even when no session-specific history applies.
  limit: z.coerce.number().int().min(1).max(500).default(120),
  // Extra scan budget lets the run index retain a fresh session's opening runs
  // even after the flat recent window has rolled forward.
  scanLimit: z.coerce.number().int().min(1).max(10_000).default(2_400),
});

export const LoopwatchConvergenceQuerySchema = LoopwatchRunsQuerySchema.extend({
  pivotMode: z.enum(['calm', 'loud']).optional(),
});

export const LoopwatchLoopRecommendationQuerySchema = z.object({
  task: z.string().trim().min(1),
});
