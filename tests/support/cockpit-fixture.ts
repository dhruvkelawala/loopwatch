import { z } from 'zod';

import { EngineHealthSchema, LoopwatchRunsResponseSchema } from '../../ui/src/schemas/loopwatch.js';

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

export function validateCockpitEngineFixture(): void {
  EngineHealthSchema.parse(cockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(cockpitEngineFixture.runs);
  z.literal(0).parse(cockpitEngineFixture.runs.runs.length);
  EngineHealthSchema.parse(securedCockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(securedCockpitEngineFixture.runs);
  z.literal(1).parse(securedCockpitEngineFixture.runEvents.length);
}
