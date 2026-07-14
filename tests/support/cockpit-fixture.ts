import { z } from 'zod';

import { EngineHealthSchema, LoopwatchRunsResponseSchema } from '../../ui/src/schemas/loopwatch.js';

const ConvergenceSpendSchema = z.object({
  cheapCalls: z.number().int().nonnegative(),
  strongCalls: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

const GitEvidenceSnapshotSchema = z.object({
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

const LoopAnchorSchema = z.object({
  loopId: z.string().min(1),
  title: z.string().min(1),
  source: z.literal('opening_prompt'),
  confidence: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1).optional(),
  reason: z.string().min(1),
  stopCondition: z.object({
    evidence: z.string().min(1),
    observable: z.boolean(),
  }),
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

const PivotNudgeSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  timestamp: z.string().min(1),
  mode: z.enum(['calm', 'loud']),
  source: z.literal('user_redirection'),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendedAction: z.string().min(1),
  fromGoal: z.string().min(1),
  toGoal: z.string().min(1),
});

const PostSessionInsightSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  createdAt: z.string().min(1),
  source: z.literal('post_session'),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
  evidenceEventIds: z.array(z.string().min(1)).min(1),
  signal: z.enum(['drift', 'burn', 'weak_validation', 'churn', 'completion_without_evidence']),
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
    provider: z.string().min(1),
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
  git: GitEvidenceSnapshotSchema.optional(),
  loopAnchor: LoopAnchorSchema.optional(),
  pivotNudge: PivotNudgeSchema.optional(),
  postSessionInsight: PostSessionInsightSchema.optional(),

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

export const watchtowerCockpitFixture = {
  health: {
    ok: true,
    service: 'loopwatch-watchtower-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [
      {
        runId: 'run-watchtower-cockpit-ui',
        workflowName: 'record-events',
        status: 'completed',
        startedAt: '2026-07-04T14:00:00.000Z',
        endedAt: '2026-07-04T14:59:45.000Z',
        durationMs: 3_585_000,
      },
    ],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [
      {
        id: 'claude:watchtower-active',
        source: 'claude',
        sessionId: 'watchtower-active',
        status: 'intervention',
        liveness: 'active',
        summary: {
          goal: 'Stabilize Watchtower Cockpit fidelity with populated-source evidence.',
          done: ['rendered three-pane cockpit shell', 'captured source capability badges'],
          validation: ['pnpm e2e:cockpit is still red on the convergence readout'],
          concerns: ['Cost lane is empty even though usage evidence exists', 'Convergence dial still shows placeholder copy'],
        },
        evidence: [
          {
            eventId: 'watchtower-cost-lane-empty',
            timestamp: '2026-07-04T14:59:45.000Z',
            kind: 'usage',
            severity: 'watch',
            signal: 'burn',
            title: 'Cost evidence is not in the cost lane',
            detail: 'Usage evidence recorded 3200 tokens and $0.003210 but the populated lane is missing.',
          },
          {
            eventId: 'watchtower-placeholder-readout',
            timestamp: '2026-07-04T14:59:46.000Z',
            kind: 'diagnostic',
            severity: 'intervention',
            signal: 'completion_without_evidence',
            title: 'Convergence readout is still placeholder copy',
            detail: 'The selected session must show the strong judge tier, call count, and spend instead of Slice 6 placeholder text.',
            recommendedAction: 'Replace placeholder convergence copy with the selected session judge tier, last reason, call count, and spend.',
          },
        ],
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'strong',
          lastRunAt: '2026-07-04T14:59:46.000Z',
          nextEligibleAt: '2026-07-04T15:00:46.000Z',
          lastReason: 'completion_without_evidence',
          rateCapMs: 60_000,
        },
        spend: {
          cheapCalls: 2,
          strongCalls: 1,
          totalCalls: 3,
          estimatedTokens: 3_200,
          estimatedCostUsd: 0.00321,
        },
        git: {
          repoRoot: '/Users/d/dev/loopwatch',
          repo: 'loopwatch',
          branch: 'watchtower-cockpit',
          dirty: true,
          changedFiles: ['ui/src/cockpit/timeline.tsx', 'ui/src/cockpit/session-rail.tsx'],
          diff: {
            files: 2,
            insertions: 42,
            deletions: 7,
          },
          head: {
            sha: 'abc1234',
            subject: 'Expose Watchtower Cockpit live readouts',
            committedAt: '2026-07-04T14:40:00.000Z',
          },
          validation: {
            status: 'failed',
            detail: 'pnpm e2e:cockpit failed before readout wiring landed',
            eventId: 'watchtower-validation-red',
          },
          sampledAt: '2026-07-04T14:59:44.000Z',
        },
        eventCount: 6,
        meaningfulEventCount: 6,
        lastEventAt: '2026-07-04T14:59:45.000Z',
      },
      {
        id: 'pi:watchtower-idle',
        source: 'pi',
        sessionId: 'watchtower-idle',
        status: 'watch',
        liveness: 'idle',
        summary: {
          goal: 'Verify Pi source parity in the Watchtower rail.',
          done: ['reported direct Pi token and cost evidence'],
          validation: ['pnpm source:check passed'],
          concerns: ['Freshness should show idle without collapsing the row into the active Claude group'],
        },
        evidence: [
          {
            eventId: 'pi-idle-freshness',
            timestamp: '2026-07-04T14:50:00.000Z',
            kind: 'usage',
            severity: 'watch',
            signal: 'drift',
            title: 'Pi source is idle but fresh enough to inspect',
            detail: 'The Pi session last wrote 10m ago and should keep its .liv idle freshness tag.',
          },
        ],
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'cheap',
          lastRunAt: '2026-07-04T14:50:01.000Z',
          nextEligibleAt: '2026-07-04T14:51:01.000Z',
          lastReason: 'drift',
          rateCapMs: 60_000,
        },
        spend: {
          cheapCalls: 1,
          strongCalls: 0,
          totalCalls: 1,
          estimatedTokens: 400,
          estimatedCostUsd: 0.00028,
        },
        eventCount: 2,
        meaningfulEventCount: 2,
        lastEventAt: '2026-07-04T14:50:00.000Z',
      },
      {
        id: 'codex:watchtower-ended',
        source: 'codex',
        sessionId: 'watchtower-ended',
        status: 'calm',
        liveness: 'ended',
        summary: {
          goal: 'Archive the Codex adapter smoke evidence for Watchtower.',
          done: ['preserved Codex transcript and branch evidence'],
          validation: ['pnpm adapter:check passed'],
          concerns: [],
        },
        evidence: [],
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'cheap',
          lastRunAt: '2026-07-04T14:00:03.000Z',
          nextEligibleAt: '2026-07-04T14:01:03.000Z',
          rateCapMs: 60_000,
        },
        spend: {
          cheapCalls: 1,
          strongCalls: 1,
          totalCalls: 2,
          estimatedTokens: 2_000,
          estimatedCostUsd: 0.00071,
        },
        eventCount: 2,
        meaningfulEventCount: 2,
        lastEventAt: '2026-07-04T14:00:02.000Z',
      },
    ],
    spend: {
      cheapCalls: 4,
      strongCalls: 2,
      totalCalls: 6,
      estimatedTokens: 5_600,
      estimatedCostUsd: 0.0042,
    },
    nextPollMs: 2_000,
  },
  runEvents: [
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'watchtower-active',
        timestamp: '2026-07-04T14:59:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'watchtower-cockpit' },
        payload: { content: 'Stabilize Watchtower Cockpit fidelity with populated-source evidence.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'watchtower-active',
        timestamp: '2026-07-04T14:59:05.000Z',
        kind: 'system',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'watchtower-cockpit' },
        payload: { content: 'Watchtower cockpit source adapter attached.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'watchtower-active',
        timestamp: '2026-07-04T14:59:10.000Z',
        kind: 'tool_call',
        actor: { type: 'agent' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'watchtower-cockpit' },
        payload: {
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'edit',
                input: { path: 'ui/src/cockpit/timeline.tsx' },
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
        sessionId: 'watchtower-active',
        timestamp: '2026-07-04T14:59:25.000Z',
        kind: 'tool_call',
        actor: { type: 'agent' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'watchtower-cockpit' },
        payload: {
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'bash',
                input: { command: 'pnpm playwright test tests/e2e/cockpit.spec.ts' },
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
        sessionId: 'watchtower-active',
        timestamp: '2026-07-04T14:59:35.000Z',
        kind: 'tool_result',
        actor: { type: 'tool', name: 'bash' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'watchtower-cockpit' },
        payload: {
          toolName: 'bash',
          validation: { command: 'pnpm playwright test tests/e2e/cockpit.spec.ts', exitCode: 1 },
          content: 'pnpm e2e:cockpit failed before convergence readout wiring landed',
        },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'watchtower-active',
        timestamp: '2026-07-04T14:59:45.000Z',
        kind: 'usage',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'watchtower-cockpit' },
        payload: { usage: { totalTokens: 3_200, cost: { total: 0.00321 } } },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'pi',
        sessionId: 'watchtower-idle',
        timestamp: '2026-07-04T14:49:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'pi-source-parity' },
        payload: { content: 'Verify Pi source parity in the Watchtower rail.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'pi',
        sessionId: 'watchtower-idle',
        timestamp: '2026-07-04T14:50:00.000Z',
        kind: 'usage',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'pi-source-parity' },
        payload: { usage: { input: 120, output: 280, costUsd: 0.00028 } },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'codex',
        sessionId: 'watchtower-ended',
        timestamp: '2026-07-04T14:00:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/adapter-lab', repo: 'adapter-lab', gitBranch: 'codex-archive' },
        payload: { content: 'Archive the Codex adapter smoke evidence for Watchtower.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'codex',
        sessionId: 'watchtower-ended',
        timestamp: '2026-07-04T14:00:02.000Z',
        kind: 'tool_call',
        actor: { type: 'agent' },
        context: { cwd: '/Users/d/dev/adapter-lab', repo: 'adapter-lab', gitBranch: 'codex-archive' },
        payload: {
          tool: {
            name: 'bash',
            arguments: { command: 'pnpm adapter:check' },
          },
        },
      },
    },
  ],
} as const;

export const pivotCockpitEngineFixture = {
  health: {
    ok: true,
    service: 'loopwatch-pivot-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [
      {
        runId: 'run-pivot-nudge',
        workflowName: 'record-events',
        status: 'completed',
        startedAt: '2026-07-04T14:00:00.000Z',
        endedAt: '2026-07-04T14:00:07.000Z',
        durationMs: 7000,
      },
    ],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [
      {
        id: 'claude:cockpit-pivot-session',
        source: 'claude',
        sessionId: 'cockpit-pivot-session',
        status: 'calm',
        liveness: 'active',
        summary: {
          goal: 'Ship issue #15 Pivot detection with a fresh-session nudge.',
          done: ['added deterministic Pivot detector coverage'],
          validation: ['pnpm convergence:check exited 0'],
          concerns: [],
        },
        evidence: [],
        pivotNudge: {
          id: 'pivot-nudge-cockpit-redirection',
          eventId: 'pivot-cockpit-redirection',
          timestamp: '2026-07-04T14:00:06.000Z',
          mode: 'calm',
          source: 'user_redirection',
          title: 'User pivot detected',
          detail: 'The user switched from Loopwatch Pivot detection to an onboarding email campaign after prior work was already underway.',
          recommendedAction: 'Start a fresh session for the onboarding email campaign. Loopwatch will not create, control, or start one for you.',
          fromGoal: 'Ship issue #15 Pivot detection with a fresh-session nudge.',
          toGoal: 'Draft an onboarding email campaign for new workspace admins.',
        },
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'cheap',
          lastRunAt: '2026-07-04T14:00:07.000Z',
          nextEligibleAt: '2026-07-04T14:01:07.000Z',
          lastReason: 'pivot',
          rateCapMs: 60_000,
        },
        spend: {
          cheapCalls: 1,
          strongCalls: 0,
          totalCalls: 1,
          estimatedTokens: 350,
          estimatedCostUsd: 0.00007,
        },
        eventCount: 4,
        meaningfulEventCount: 4,
        lastEventAt: '2026-07-04T14:00:06.000Z',
      },
    ],
    spend: {
      cheapCalls: 1,
      strongCalls: 0,
      totalCalls: 1,
      estimatedTokens: 350,
      estimatedCostUsd: 0.00007,
    },
    nextPollMs: 2_000,
  },
  runEvents: [
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-pivot-session',
        timestamp: '2026-07-04T14:00:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-13-pivot' },
        payload: { id: 'pivot-cockpit-goal', text: 'Ship issue #15 Pivot detection with a fresh-session nudge.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-pivot-session',
        timestamp: '2026-07-04T14:00:02.000Z',
        kind: 'tool_call',
        actor: { type: 'agent', name: 'edit' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-13-pivot' },
        payload: { id: 'pivot-cockpit-edit', toolName: 'edit', command: 'edit scripts/check-convergence-watcher.ts' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-pivot-session',
        timestamp: '2026-07-04T14:00:04.000Z',
        kind: 'message',
        actor: { type: 'agent' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-13-pivot' },
        payload: { id: 'pivot-cockpit-progress', text: 'The Pivot detection tests are in progress.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'cockpit-pivot-session',
        timestamp: '2026-07-04T14:00:06.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'slice-13-pivot' },
        payload: { id: 'pivot-cockpit-redirection', text: 'Actually, switch topics: draft an onboarding email campaign for new workspace admins.' },
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

export const postSessionInsightCockpitEngineFixture = {
  health: {
    ok: true,
    service: 'loopwatch-post-session-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [
      {
        runId: 'run-post-session-insight',
        workflowName: 'record-events',
        status: 'completed',
        startedAt: '2026-07-04T14:00:00.000Z',
        endedAt: '2026-07-04T14:00:04.000Z',
        durationMs: 4000,
      },
    ],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [
      {
        id: 'claude:post-session-insight-session',
        source: 'claude',
        sessionId: 'post-session-insight-session',
        status: 'watch',
        liveness: 'ended',
        summary: {
          goal: 'Ship issue #16 with deterministic post-session coaching insight tests.',
          done: ['wired the issue #16 test fixture'],
          validation: ['pnpm convergence:check exited 1'],
          concerns: ['Validation failed before the session converged'],
        },
        evidence: [
          {
            eventId: 'post-session-validation-fail',
            timestamp: '2026-07-04T14:00:03.000Z',
            kind: 'tool_result',
            severity: 'watch',
            signal: 'weak_validation',
            title: 'Validation failed before the session converged',
            detail: 'pnpm convergence:check exited 1',
          },
        ],
        postSessionInsight: {
          id: 'post-session:claude:post-session-insight-session:post-session-validation-fail:weak_validation',
          sessionId: 'post-session-insight-session',
          createdAt: '2026-07-04T14:45:00.000Z',
          source: 'post_session',
          title: 'Post-session coaching: validation failed before convergence',
          detail: 'Evidence post-session-validation-fail raised weak_validation after the ended session: pnpm convergence:check exited 1',
          recommendation: 'Before marking the next slice done, run pnpm convergence:check until it passes and cite the failing validation receipt post-session-validation-fail.',
          evidenceEventIds: ['post-session-validation-fail'],
          signal: 'weak_validation',
        },
        judge: {
          provider: 'deterministic-fake-v1',
          lastTier: 'strong',
          lastRunAt: '2026-07-04T14:00:04.000Z',
          nextEligibleAt: '2026-07-04T14:01:04.000Z',
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
        eventCount: 3,
        meaningfulEventCount: 3,
        lastEventAt: '2026-07-04T14:00:04.000Z',
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
        sessionId: 'post-session-insight-session',
        timestamp: '2026-07-04T14:00:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'issue-16-post-session' },
        payload: { id: 'post-session-opening', text: 'Ship issue #16 with deterministic post-session coaching insight tests.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'post-session-insight-session',
        timestamp: '2026-07-04T14:00:02.000Z',
        kind: 'tool_call',
        actor: { type: 'agent' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'issue-16-post-session' },
        payload: {
          id: 'post-session-validation-call',
          toolName: 'bash',
          command: 'pnpm convergence:check',
        },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'post-session-insight-session',
        timestamp: '2026-07-04T14:00:03.000Z',
        kind: 'tool_result',
        actor: { type: 'tool' },
        context: { cwd: '/Users/d/dev/loopwatch', repo: 'loopwatch', gitBranch: 'issue-16-post-session' },
        payload: {
          id: 'post-session-validation-fail',
          toolName: 'bash',
          command: 'pnpm convergence:check',
          exitCode: 1,
          output: 'pnpm convergence:check exited 1',
        },
      },
    },
  ],
} as const;

export const upgradesCockpitEngineFixture = {
  health: {
    ok: true,
    service: 'loopwatch-upgrades-fixture-engine',
    target: 'playwright',
  },
  runs: {
    ok: true,
    runs: [
      {
        runId: 'run-upgrades-evidence',
        workflowName: 'record-events',
        status: 'completed',
        startedAt: '2026-07-04T15:00:00.000Z',
        endedAt: '2026-07-04T15:00:09.000Z',
        durationMs: 9000,
      },
    ],
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
  runEvents: [
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-alpha',
        timestamp: '2026-07-04T15:00:00.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-alpha', repo: 'loopwatch', gitBranch: 'issue-17-alpha' },
        payload: { id: 'upgrade-alpha-goal', content: 'Ship issue #17 Upgrades inbox with propose-only cards.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-alpha',
        timestamp: '2026-07-04T15:00:01.000Z',
        kind: 'tool_call',
        actor: { type: 'agent', name: 'bash' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-alpha', repo: 'loopwatch', gitBranch: 'issue-17-alpha' },
        payload: { id: 'upgrade-alpha-check', toolName: 'bash', command: 'pnpm e2e:cockpit' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-alpha',
        timestamp: '2026-07-04T15:00:02.000Z',
        kind: 'usage',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-alpha', repo: 'loopwatch', gitBranch: 'issue-17-alpha' },
        payload: { id: 'upgrade-alpha-usage', usage: { totalTokens: 1440 } },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-alpha',
        timestamp: '2026-07-04T15:00:03.000Z',
        kind: 'assistant_event.delta',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-alpha', repo: 'loopwatch', gitBranch: 'issue-17-alpha' },
        payload: {
          id: 'upgrade-alpha-unknown',
          nativeType: 'assistant_event.delta',
          fragment: 'assistant streamed an event shape Loopwatch does not parse yet',
        },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-beta',
        timestamp: '2026-07-04T15:00:05.000Z',
        kind: 'message',
        actor: { type: 'user' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-beta', repo: 'loopwatch', gitBranch: 'issue-17-beta' },
        payload: { id: 'upgrade-beta-goal', content: 'Add a second session so blind spots accumulate over time.' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-beta',
        timestamp: '2026-07-04T15:00:06.000Z',
        kind: 'tool_call',
        actor: { type: 'agent', name: 'bash' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-beta', repo: 'loopwatch', gitBranch: 'issue-17-beta' },
        payload: { id: 'upgrade-beta-check', toolName: 'bash', command: 'pnpm upgrades:check' },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-beta',
        timestamp: '2026-07-04T15:00:07.000Z',
        kind: 'usage',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-beta', repo: 'loopwatch', gitBranch: 'issue-17-beta' },
        payload: { id: 'upgrade-beta-usage', usage: { totalTokens: 1560 } },
      },
    },
    {
      type: 'log',
      message: 'loopwatch.event.recorded',
      attributes: {
        source: 'claude',
        sessionId: 'upgrade-gap-beta',
        timestamp: '2026-07-04T15:00:08.000Z',
        kind: 'assistant_event.delta',
        actor: { type: 'system' },
        context: { cwd: '/Users/d/dev/loopwatch/upgrade-beta', repo: 'loopwatch', gitBranch: 'issue-17-beta' },
        payload: {
          id: 'upgrade-beta-unknown',
          nativeType: 'assistant_event.delta',
          fragment: 'another preserved assistant-native event delta',
        },
      },
    },
  ],
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
  EngineHealthSchema.parse(watchtowerCockpitFixture.health);
  LoopwatchRunsResponseSchema.parse(watchtowerCockpitFixture.runs);
  ConvergenceResponseSchema.parse(watchtowerCockpitFixture.convergence);
  z.literal(3).parse(watchtowerCockpitFixture.convergence.sessions.length);
  z.literal(10).parse(watchtowerCockpitFixture.runEvents.length);
  EngineHealthSchema.parse(pivotCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(pivotCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(pivotCockpitEngineFixture.convergence);
  z.literal(1).parse(pivotCockpitEngineFixture.convergence.sessions.length);
  z.literal(4).parse(pivotCockpitEngineFixture.runEvents.length);
  EngineHealthSchema.parse(noActionInterventionCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(noActionInterventionCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(noActionInterventionCockpitEngineFixture.convergence);
  z.literal(1).parse(noActionInterventionCockpitEngineFixture.convergence.sessions.length);
  EngineHealthSchema.parse(postSessionInsightCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(postSessionInsightCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(postSessionInsightCockpitEngineFixture.convergence);
  z.literal(1).parse(postSessionInsightCockpitEngineFixture.convergence.sessions.length);
  z.literal(3).parse(postSessionInsightCockpitEngineFixture.runEvents.length);
  EngineHealthSchema.parse(upgradesCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(upgradesCockpitEngineFixture.runs);
  ConvergenceResponseSchema.parse(upgradesCockpitEngineFixture.convergence);
  z.literal(0).parse(upgradesCockpitEngineFixture.convergence.sessions.length);
  z.literal(8).parse(upgradesCockpitEngineFixture.runEvents.length);
}
