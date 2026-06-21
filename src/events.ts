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

/**
 * Conventional Loopwatch sources. The set is documentation of the sources we
 * adapt today; the schema accepts any string so a new source can be added
 * without a schema change.
 */
export const SOURCES = ['claude', 'codex', 'pi'] as const;
export type Source = (typeof SOURCES)[number];

/** Fixed vocabulary for the common-core {@link Actor.type}. */
export const ACTOR_TYPES = ['user', 'agent', 'tool', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Per-event derived context — repo, branch, and working directory labels
 * (ADR-0003). These describe *where* an event happened but are explicitly NOT
 * part of session identity: one source session stays one Loopwatch session even
 * when the work moves across repos, branches, or worktrees mid-session.
 * Grouping and filtering by repo/branch is a view concern served by these
 * labels. Loose so a source can attach extra context (e.g. `version`) verbatim.
 *
 * @see docs/adr/0003-session-identity-follows-the-source.md
 */
export const EventContextSchema = z.looseObject({
  cwd: z.string().optional(),
  repo: z.string().optional(),
  gitBranch: z.string().optional(),
});
export type EventContext = z.infer<typeof EventContextSchema>;

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
 *   - `source`    — the source that produced this (claude / codex / pi / …)
 *   - `sessionId` — the source-native session id this event belongs to
 *   - `timestamp` — when the activity occurred (ISO 8601)
 *   - `kind`      — event kind (a {@link EVENT_KINDS} value, or any
 *                   source-native string)
 *   - `actor`     — who/what produced the activity
 *
 * Session identity is the pair `(source, sessionId)` (ADR-0003); use
 * {@link sessionKey} to derive the stable composite key. `context` carries
 * per-event repo/branch/cwd labels (derived context, not identity). Source
 * extras — the conventional `payload` bag plus any other top-level field — are
 * preserved verbatim via the loose schema. See the module docstring for the
 * no-drop guarantee.
 *
 * The common-core field list was deliberately left open in ADR-0004 "to be
 * fixed when the first adapter is built"; `source` and `context` were added
 * when the Claude adapter (the first Source Adapter) landed.
 */
export const LoopwatchEventSchema = z.looseObject({
  // Identity fields are non-empty: an event with no source/session can't be
  // attributed to an Agent Session, so it's rejected rather than stored blank.
  source: z.string().min(1),
  sessionId: z.string().min(1),
  timestamp: z.string(),
  kind: z.string().min(1),
  actor: ActorSchema,
  context: EventContextSchema.optional(),
  payload: z.unknown().optional(),
});
export type LoopwatchEvent = z.infer<typeof LoopwatchEventSchema>;

/** The two fields that together identify an Agent Session (ADR-0003). */
export interface SessionIdentity {
  source: string;
  sessionId: string;
}

/**
 * Derive the stable composite session key `(source, sessionId)` (ADR-0003).
 * One source session is one Loopwatch session; this key is how downstream
 * consumers group events without splitting or stitching sessions.
 */
export function sessionKey(identity: SessionIdentity): string {
  return `${identity.source}:${identity.sessionId}`;
}

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
