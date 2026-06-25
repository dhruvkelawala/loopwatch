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
