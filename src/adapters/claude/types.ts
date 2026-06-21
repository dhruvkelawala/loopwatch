/**
 * Claude Code Source Adapter — shared types and constants (issue #5).
 *
 * Claude Code writes one JSONL transcript per session under
 * `~/.claude/projects/<project-slug>/<sessionId>.jsonl`. Each line is a record
 * stamped with `sessionId`, `uuid`, `timestamp`, and per-record `cwd` +
 * `gitBranch`. The adapter tails these files and maps each record to a
 * normalized Loopwatch Event (ADR-0004), keyed by source identity (ADR-0003).
 */

/** The source name this adapter emits (ADR-0003 identity, part 1). */
export const CLAUDE_SOURCE = 'claude';

/** Default transcript root. Recurse with `**\/*.jsonl` (sharded by project slug). */
export const CLAUDE_PROJECTS_ROOT = '~/.claude/projects';

/**
 * Parser version, persisted in each transcript cursor. Bump when the record →
 * event mapping changes in a way that would make a resumed byte offset emit
 * different events than a fresh read, so a stale cursor can be detected.
 */
export const PARSER_VERSION = 1;

/**
 * A raw Claude Code transcript record. Only the fields the adapter reads are
 * typed; everything else is preserved verbatim into the event payload, so the
 * loose index signature is intentional (ADR-0004 no-drop).
 */
export interface ClaudeRecord {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  message?: { role?: string; content?: unknown };
  [key: string]: unknown;
}
