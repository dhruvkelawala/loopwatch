import { defineWorkflow, type JsonValue, type WorkflowRouteHandler, type WorkflowRunsHandler } from '@flue/runtime';
import * as v from 'valibot';
import { toLoopwatchEvent, type LoopwatchEventInput } from '../events.js';
import { loopwatchWorkflowAgent } from '../workflow-agent.js';

export const route: WorkflowRouteHandler = async (_c, next) => next();
export const runs: WorkflowRunsHandler = async (_c, next) => next();

/** Batch payload: the normalized events produced by one transcript append. */
export interface RecordEventsPayload {
  events: LoopwatchEventInput[];
}

/**
 * Batch ingest boundary for normalized Loopwatch Events.
 *
 * A Source Adapter tailing a transcript produces many events per file append.
 * Rather than one workflow run per record, this records a whole append in a
 * single run: it validates each event's common core while preserving every
 * source-specific field (ADR-0004), then persists each onto Flue's Durable
 * Streams log via a structured `log` event (file-backed in the configured
 * SQLite store, survives restart).
 *
 * Validation is all-or-nothing per request: a malformed event throws a
 * ZodError and the run fails rather than partially recording, so the adapter's
 * cursor is only advanced after a committed (2xx) batch.
 */
export default defineWorkflow({
  agent: loopwatchWorkflowAgent,
  input: v.looseObject({
    events: v.optional(v.array(v.looseObject({}))),
  }),
  run({ input, log }) {
    const inputs = Array.isArray(input.events) ? input.events : [];
    const events = inputs.map((eventInput) => toLoopwatchEvent(eventInput));

    for (const event of events) {
      log.info('loopwatch.event.recorded', event);
    }

    return { recorded: events.length, events } as unknown as JsonValue;
  },
});
