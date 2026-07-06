/**
 * Codex Source Adapter — shared types and constants (issue #11).
 *
 * Codex writes one JSONL rollout per session under
 * `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl`. Every line is
 * an envelope `{ type, payload, timestamp }`: `type` is the outer record class
 * (`session_meta`, `event_msg`, `response_item`, `turn_context`, `compacted`)
 * and `payload.type` is the specific event. Only the head `session_meta`
 * stamps `cwd` + `git` (branch / repository_url); later records don't, so repo
 * context is recovered from the head and git inference (ADR-0008).
 */

/** The source name this adapter emits (ADR-0003 identity, part 1). */
export const CODEX_SOURCE = 'codex';

/** Default rollout root. Recurse with `rollout-*.jsonl` (sharded by date). */
export const CODEX_SESSIONS_ROOT = '~/.codex/sessions';

/**
 * Parser version, persisted in each rollout cursor. Bump when the record →
 * event mapping changes in a way that would make a resumed byte offset emit
 * different events than a fresh read.
 */
export const PARSER_VERSION = 1;

/** Discovery filter: Codex shards by date but every rollout is `rollout-*.jsonl`. */
export function isRolloutFile(name: string): boolean {
  return name.startsWith('rollout-') && name.endsWith('.jsonl');
}

/**
 * A raw Codex rollout record. Only the envelope fields the adapter reads are
 * typed; `payload` is preserved verbatim into the event (ADR-0004 no-drop), so
 * the loose index signature is intentional.
 */
export interface CodexRecord {
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown> | null;
  [key: string]: unknown;
}
