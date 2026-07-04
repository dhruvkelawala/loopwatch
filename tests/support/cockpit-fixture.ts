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

export function validateCockpitEngineFixture(): void {
  EngineHealthSchema.parse(cockpitEngineFixture.health);
  LoopwatchRunsResponseSchema.parse(cockpitEngineFixture.runs);
  z.literal(0).parse(cockpitEngineFixture.runs.runs.length);
}
