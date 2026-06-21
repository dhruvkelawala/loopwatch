import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';
import { toLoopwatchEvent, type LoopwatchEventInput } from '../events.js';

export const route: WorkflowRouteHandler = async (_c, next) => next();

/**
 * Ingest boundary for a normalized Loopwatch Event.
 *
 * Validates the common core while preserving every source-specific field
 * (ADR-0004), then persists the event onto Flue's Durable Streams log for this
 * run. The validated event becomes a structured `log` event's attributes —
 * file-backed via `data/flue.db`, so it survives restart — and is also returned
 * as the run result for convenience. Downstream read/aggregation happens in a
 * later slice.
 */
export async function run({ payload, log }: FlueContext<LoopwatchEventInput>) {
  const input = (payload ?? {}) as Record<string, unknown>;
  const event = toLoopwatchEvent(input);

  log.info('loopwatch.event.recorded', event);

  return event;
}
