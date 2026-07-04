/**
 * Pi Source Adapter — shared types and constants (issue #11).
 *
 * Pi (SumoCode) writes one JSONL session per run under
 * `~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<uuid>.jsonl`. Records are typed
 * events: a head `session` (with `cwd`), `message` records keyed by
 * `message.role` (`user` / `assistant` / `toolResult` / `bashExecution`), plus
 * `model_change`, `thinking_level_change`, `custom`, and `compaction`
 * diagnostics. Assistant messages carry `usage.cost.total` — a direct `$` cost,
 * Pi's distinguishing capability. Pi records no git branch, so repo + branch are
 * inferred from git (ADR-0008).
 */

/** The source name this adapter emits (ADR-0003 identity, part 1). */
export const PI_SOURCE = 'pi';

/** Default sessions root. Recurse with `*.jsonl` (sharded by cwd slug). */
export const PI_SESSIONS_ROOT = '~/.pi/agent/sessions';

/**
 * Parser version, persisted in each session cursor. Bump when the record →
 * event mapping changes in a way that would make a resumed byte offset emit
 * different events than a fresh read.
 */
export const PARSER_VERSION = 1;

/**
 * A raw Pi session record. Only the fields the adapter reads are typed;
 * everything else (notably `message.usage.cost`) is preserved verbatim into the
 * event payload (ADR-0004 no-drop), so the loose index signature is intentional.
 */
export interface PiRecord {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  message?: { role?: string; content?: unknown; usage?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}
