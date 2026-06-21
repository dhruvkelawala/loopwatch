import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';
import { toLoopwatchEvent, type LoopwatchEventInput } from '../events.js';

export const route: WorkflowRouteHandler = async (_c, next) => next();

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
 * Streams log via a structured `log` event (file-backed in `data/flue.db`,
 * survives restart).
 *
 * Validation is all-or-nothing per request: a malformed event throws a
 * ZodError and the run fails rather than partially recording, so the adapter's
 * cursor is only advanced after a committed (2xx) batch.
 */
export async function run({ payload, log }: FlueContext<RecordEventsPayload>) {
  const inputs = Array.isArray(payload?.events) ? payload.events : [];
  const events = inputs.map((input) => toLoopwatchEvent(input as Record<string, unknown>));

  for (const event of events) {
    log.info('loopwatch.event.recorded', event);
  }

  return { recorded: events.length, events };
}
