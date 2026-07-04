import { z } from 'zod';

import { EngineHealthSchema, LoopwatchRunsResponseSchema } from '../../ui/src/schemas/loopwatch.js';

const ConvergenceSpendSchema = z.object({
  cheapCalls: z.number().int().nonnegative(),
  strongCalls: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

const ConvergenceSummarySchema = z.object({
  goal: z.string().min(1),
  done: z.array(z.string()),
  validation: z.array(z.string()),
  concerns: z.array(z.string()),
});

const ConvergenceEvidenceSchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.string().min(1),
  kind: z.string().min(1),
  severity: z.enum(['calm', 'watch', 'intervention']),
  signal: z.enum(['drift', 'burn', 'weak_validation', 'churn', 'completion_without_evidence']),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendedAction: z.string().min(1).optional(),
});

const ConvergenceSessionSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(['calm', 'watch', 'intervention']),
  liveness: z.enum(['active', 'idle', 'ended']),
  summary: ConvergenceSummarySchema,
  evidence: z.array(ConvergenceEvidenceSchema),
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
  lastEventAt: z.string().min(1),
});

const ConvergenceResponseSchema = z.object({
  ok: z.literal(true),
  sessions: z.array(ConvergenceSessionSchema),
  spend: ConvergenceSpendSchema,
  nextPollMs: z.number().int().positive(),
});

export const cockpitEngineFixture = {
  health: {
    ok: true,
    service: 'loopwatch-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [],
    spend: {
      cheapCalls: 0,
      strongCalls: 0,
      totalCalls: 0,
      estimatedTokens: 0,
      estimatedCostUsd: 0,
    },
    nextPollMs: 2_000,
  },
} as const;

export const securedCockpitEngineFixture = {
  token: 'cockpit-runtime-token-22',
  runtimeConfig: {
    baseUrl: '/api',
    bearerToken: 'cockpit-runtime-token-22',
  },
  health: {
    ok: true,
    service: 'loopwatch-secured-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [
      {
        runId: 'run-secured-completed',
        workflowName: 'record-events',
        status: 'completed',
        startedAt: '2026-07-04T12:00:00.000Z',
        endedAt: '2026-07-04T12:00:01.000Z',
        durationMs: 1000,
      },
    ],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [
      {
        id: 'claude:cockpit-secured-session',
        source: 'claude',
        sessionId: 'cockpit-secured-session',
        status: 'watch',
        liveness: 'active',
        summary: {
          goal: 'Ship Slice 6 convergence watcher and surface it in Cockpit.',
          done: ['wired convergence endpoint fetch'],
          validation: ['pnpm convergence:check exited 1'],
          concerns: ['Validation failed before the session converged'],
        },
        evidence: [
          {
            eventId: 'cockpit-validation-fail',
            timestamp: '2026-07-04T12:00:02.000Z',
            kind: 'tool_result',
            severity: 'watch',
            signal: 'weak_validation',
            title: 'Validation failed before the session converged',
            detail: 'pnpm convergence:check exited 1',
          },
        ],
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'strong',
          lastRunAt: '2026-07-04T12:00:03.000Z',
          nextEligibleAt: '2026-07-04T12:01:03.000Z',
          lastReason: 'weak_validation',
          rateCapMs: 60_000,
        },
        spend: {
          cheapCalls: 1,
          strongCalls: 1,
          totalCalls: 2,
          estimatedTokens: 1_750,
          estimatedCostUsd: 0.00147,
        },
        eventCount: 2,
        meaningfulEventCount: 2,
        lastEventAt: '2026-07-04T12:00:02.000Z',
      },
    ],
    spend: {
      cheapCalls: 1,
      strongCalls: 1,
      totalCalls: 2,
      estimatedTokens: 1_750,
      estimatedCostUsd: 0.00147,
    },
    nextPollMs: 2_000,
  },
  runEvents: [
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-secured-session',
        timestamp: '2026-07-04T12:00:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', gitBranch: 'main' },
      },
    },
  ],
} as const;

export const interventionCockpitEngineFixture = {
  health: {
    ok: true,
    service: 'loopwatch-intervention-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [
      {
        runId: 'run-intervention-validation',
        workflowName: 'record-events',
        status: 'completed',
        startedAt: '2026-07-04T13:00:00.000Z',
        endedAt: '2026-07-04T13:00:04.000Z',
        durationMs: 4000,
      },
    ],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [
      {
        id: 'claude:cockpit-intervention-session',
        source: 'claude',
        sessionId: 'cockpit-intervention-session',
        status: 'intervention',
        liveness: 'active',
        summary: {
          goal: 'Ship the Slice 7 intervention surface without hiding unresolved concerns.',
          done: ['rendered the convergence watcher status'],
          validation: ['pnpm convergence:check exited 1'],
          concerns: ['Validation repair is churning', 'Completion claim lacks validation evidence'],
        },
        evidence: [
          {
            eventId: 'watch-context-drift',
            timestamp: '2026-07-04T13:00:01.000Z',
            kind: 'message',
            severity: 'watch',
            signal: 'drift',
            title: 'Goal drift is accumulating',
            detail: 'The session discussed adjacent cleanup before resolving the failed validation.',
          },
          {
            eventId: 'intervention-validation-churn',
            timestamp: '2026-07-04T13:00:03.000Z',
            kind: 'tool_result',
            severity: 'intervention',
            signal: 'churn',
            title: 'Validation repair is churning',
            detail: 'pnpm convergence:check exited 1 after repeated repair attempts',
            recommendedAction: 'Pause the repair loop, isolate the failing check, and land the smallest change that makes it pass.',
          },
          {
            eventId: 'intervention-completion-without-evidence',
            timestamp: '2026-07-04T13:00:04.000Z',
            kind: 'message',
            severity: 'intervention',
            signal: 'completion_without_evidence',
            title: 'Completion claim lacks validation evidence',
            detail: 'The session claimed convergence without attaching a passing validation receipt.',
            recommendedAction: 'Request the missing validation receipt before accepting the completion claim.',
          },
        ],
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'strong',
          lastRunAt: '2026-07-04T13:00:04.000Z',
          nextEligibleAt: '2026-07-04T13:01:04.000Z',
          lastReason: 'churn',
          rateCapMs: 60_000,
        },
        spend: {
          cheapCalls: 2,
          strongCalls: 1,
          totalCalls: 3,
          estimatedTokens: 2_100,
          estimatedCostUsd: 0.00192,
        },
        eventCount: 4,
        meaningfulEventCount: 4,
        lastEventAt: '2026-07-04T13:00:04.000Z',
      },
    ],
    spend: {
      cheapCalls: 2,
      strongCalls: 1,
      totalCalls: 3,
      estimatedTokens: 2_100,
      estimatedCostUsd: 0.00192,
    },
    nextPollMs: 2_000,
  },
  runEvents: [
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-intervention-session',
        timestamp: '2026-07-04T13:00:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-7-intervention' },
        payload: { content: 'Ship the Slice 7 intervention surface without hiding failed validation.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-intervention-session',
        timestamp: '2026-07-04T13:00:02.000Z',
        kind: 'tool_call',
        actor: { type: 'agent' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-7-intervention' },
        payload: {
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'bash',
                input: { command: 'pnpm convergence:check' },
              },
            ],
          },
        },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-intervention-session',
        timestamp: '2026-07-04T13:00:03.000Z',
        kind: 'tool_result',
        actor: { type: 'tool' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-7-intervention' },
        payload: {
          toolName: 'bash',
          content: 'pnpm convergence:check exited 1',
        },
      },
    },
  ],
} as const;

export const noActionInterventionCockpitEngineFixture = {
  health: interventionCockpitEngineFixture.health,
  runs: interventionCockpitEngineFixture.runs,
  convergence: {
    ...interventionCockpitEngineFixture.convergence,
    sessions: [
      {
        ...interventionCockpitEngineFixture.convergence.sessions[0],
        evidence: [
          {
            eventId: 'intervention-without-action',
            timestamp: '2026-07-04T13:00:03.000Z',
            kind: 'tool_result',
            severity: 'intervention',
            signal: 'churn',
            title: 'Missing recommended action should not surface',
            detail: 'The watcher has evidence but no operator action to recommend.',
          },
        ],
      },
    ],
  },
  runEvents: interventionCockpitEngineFixture.runEvents,
} as const;

export function validateCockpitEngineFixture(): void {
  EngineHealthSchema.parse(cockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(cockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(cockpitEngineFixture.convergence);
  z.literal(0).parse(cockpitEngineFixture.runs.runs.length);
  EngineHealthSchema.parse(securedCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(securedCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(securedCockpitEngineFixture.convergence);
  z.literal(1).parse(securedCockpitEngineFixture.convergence.sessions.length);
  z.literal(1).parse(securedCockpitEngineFixture.runEvents.length);
  EngineHealthSchema.parse(interventionCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(interventionCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(interventionCockpitEngineFixture.convergence);
  z.literal(1).parse(interventionCockpitEngineFixture.convergence.sessions.length);
  z.literal(3).parse(interventionCockpitEngineFixture.runEvents.length);
  EngineHealthSchema.parse(noActionInterventionCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(noActionInterventionCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(noActionInterventionCockpitEngineFixture.convergence);
  z.literal(1).parse(noActionInterventionCockpitEngineFixture.convergence.sessions.length);
}
