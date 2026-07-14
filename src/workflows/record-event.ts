import { defineWorkflow, type JsonValue, type WorkflowRouteHandler, type WorkflowRunsHandler } from '@flue/runtime';
import * as v from 'valibot';
import { toLoopwatchEvent } from '../events.js';
import { loopwatchWorkflowAgent } from '../workflow-agent.js';

export const route: WorkflowRouteHandler = async (_c, next) => next();
export const runs: WorkflowRunsHandler = async (_c, next) => next();

/**
 * Ingest boundary for a normalized Loopwatch Event.
 *
 * Validates the common core while preserving every source-specific field
 * (ADR-0004), then persists the event onto Flue's Durable Streams log for this
 * run. The validated event becomes a structured `log` event's attributes —
 * file-backed via the configured SQLite store, so it survives restart — and is
 * also returned as the run result for convenience. Downstream read/aggregation
 * happens in a later slice.
 */
export default defineWorkflow({
  agent: loopwatchWorkflowAgent,
  input: v.looseObject({}),
  run({ input, log }) {
    const event = toLoopwatchEvent(input);

    log.info('loopwatch.event.recorded', event);

    return event as unknown as JsonValue;
  },
});
