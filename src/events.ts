import { z } from 'zod';

/**
 * Normalized event model — ADR-0004 "shared core plus pass-through source
 * extras".
 *
 * Every Loopwatch Event carries a small common envelope that every source
 * adapter fills in, plus a flexible source-specific payload. Adapters never
 * drop data they don't recognize: unknown fields and unknown event kinds are
 * preserved verbatim and surfaced to the self-improvement loop as capability
 * gaps, not discarded. The schemas below use zod's `looseObject` precisely so
 * unknown keys round-trip intact at every level.
 *
 * @see docs/adr/0004-normalized-event-shared-core-plus-extras.md
 */

/** Fixed vocabulary for the common-core {@link Actor.type}. */
export const ACTOR_TYPES = ['user', 'agent', 'tool', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Who or what produced an observed activity. `type` is the small fixed
 * vocabulary above; every other field is source-specific (a tool name, an
 * agent id, a user handle, …) and preserved verbatim.
 */
export const ActorSchema = z.looseObject({
  type: z.enum(ACTOR_TYPES),
});
export type Actor = z.infer<typeof ActorSchema>;

/**
 * Conventional Loopwatch event kinds. The set is intentionally small; the
 * schema accepts any string so source-native kinds are preserved rather than
 * rejected. Keep this list as documentation of the kinds downstream detectors
 * know how to reason over today.
 */
export const EVENT_KINDS = [
  'message', // a conversational message (user or agent turn)
  'tool_call', // a tool was invoked
  'tool_result', // a tool returned a result
  'usage', // a token / cost / usage sample
  'session', // session lifecycle (start, end, pivot, …)
  'diagnostic', // a source-emitted diagnostic
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * A normalized record of observed session activity — the shared event
 * language downstream detectors and synthesis reason over.
 *
 * Common core (every source fills in):
 *   - `sessionId` — which Agent Session this event belongs to
 *   - `timestamp` — when the activity occurred (ISO 8601)
 *   - `kind`      — event kind (a {@link EVENT_KINDS} value, or any
 *                   source-native string)
 *   - `actor`     — who/what produced the activity
 *
 * Source extras — the conventional `payload` bag plus any other top-level
 * field — are preserved verbatim via the loose schema. See the module docstring
 * for the no-drop guarantee.
 */
export const LoopwatchEventSchema = z.looseObject({
  sessionId: z.string(),
  timestamp: z.string(),
  kind: z.string(),
  actor: ActorSchema,
  payload: z.unknown().optional(),
});
export type LoopwatchEvent = z.infer<typeof LoopwatchEventSchema>;

/** Input shape accepted by {@link toLoopwatchEvent} / the record-event workflow. */
export type LoopwatchEventInput = z.input<typeof LoopwatchEventSchema>;

/**
 * Fill common-core defaults and validate an incoming event, preserving every
 * source-specific field. Throws a zod `ZodError` when the common core is
 * missing or malformed — partial inputs are rejected, never silently coerced
 * (ADR-0004: missing data is marked unavailable, never faked). Unknown fields
 * and unknown kinds pass through untouched.
 *
 * `timestamp` defaults to "now" when a source omits it, since the record-event
 * ingest boundary is the honest place to stamp arrival time.
 */
export function toLoopwatchEvent(input: Record<string, unknown>): LoopwatchEvent {
  const record: Record<string, unknown> = { ...input };
  if (record.timestamp === undefined) {
    record.timestamp = new Date().toISOString();
  }
  return LoopwatchEventSchema.parse(record);
}
