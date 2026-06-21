import type { ActorType, EventContext, LoopwatchEventInput } from '../../events.js';
import { CLAUDE_SOURCE, type ClaudeRecord } from './types.js';

/**
 * Map a raw Claude record to a normalized Loopwatch Event (ADR-0004).
 *
 * One record → one event. The record's `type` and message content decide the
 * `kind` + `actor`; the full raw record is preserved verbatim as `payload` so
 * nothing the adapter doesn't model is lost (no-drop). Session identity is
 * `(claude, sessionId)` (ADR-0003); `cwd`/`gitBranch` become per-event context
 * labels, never part of identity.
 */

function contentBlocks(record: ClaudeRecord): Array<Record<string, unknown>> {
  const content = record.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => !!block && typeof block === 'object');
}

function hasBlockType(record: ClaudeRecord, blockType: string): boolean {
  return contentBlocks(record).some((block) => block.type === blockType);
}

/** Decide event kind + actor from the record type and its content blocks. */
function classify(record: ClaudeRecord): { kind: string; actorType: ActorType } {
  switch (record.type) {
    case 'assistant':
      // An assistant turn that calls a tool vs. one that just speaks.
      return hasBlockType(record, 'tool_use')
        ? { kind: 'tool_call', actorType: 'agent' }
        : { kind: 'message', actorType: 'agent' };
    case 'user':
      // A user record carrying tool_result is the harness returning tool output.
      return hasBlockType(record, 'tool_result')
        ? { kind: 'tool_result', actorType: 'tool' }
        : { kind: 'message', actorType: 'user' };
    case 'system':
      return { kind: 'system', actorType: 'system' };
    default:
      // Unknown/native record type (attachment, mode, ai-title, …): preserve it
      // verbatim as the kind rather than dropping it (ADR-0004).
      return {
        kind: typeof record.type === 'string' && record.type.length > 0 ? record.type : 'unknown',
        actorType: 'system',
      };
  }
}

/** Options carrying transcript-level context the record itself may omit. */
export interface MapOptions {
  /** Session id derived from the transcript filename, used when a record omits it. */
  fileSessionId?: string;
}

export function mapClaudeRecord(record: ClaudeRecord, options: MapOptions = {}): LoopwatchEventInput {
  // Identity must be non-empty (LoopwatchEventSchema rejects ''). Prefer the
  // record's own sessionId, fall back to the transcript filename, and only as a
  // last resort a sentinel — so a pathological record can never produce an
  // invalid event that would fail (and wedge) the whole ingest batch.
  const sessionId =
    typeof record.sessionId === 'string' && record.sessionId.length > 0
      ? record.sessionId
      : options.fileSessionId && options.fileSessionId.length > 0
        ? options.fileSessionId
        : 'unknown-session';

  const { kind, actorType } = classify(record);

  const context: EventContext = {};
  if (typeof record.cwd === 'string') context.cwd = record.cwd;
  if (typeof record.gitBranch === 'string') context.gitBranch = record.gitBranch;
  // Claude Code version is per-record context too; keep it as a context extra.
  if (typeof record.version === 'string') (context as Record<string, unknown>).sourceVersion = record.version;

  return {
    source: CLAUDE_SOURCE,
    sessionId,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString(),
    kind,
    actor: { type: actorType },
    context,
    // Full raw record — the no-drop guarantee. Downstream and the
    // self-improvement loop can mine anything the mapping above didn't model.
    payload: record,
  };
}

/** The session id of a transcript, derived from its `<sessionId>.jsonl` filename. */
export function sessionIdFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base;
}

/** The last record uuid in a batch, for cursor bookkeeping (idempotent resume). */
export function lastUuid(records: ClaudeRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const uuid = records[i]?.uuid;
    if (typeof uuid === 'string' && uuid.length > 0) return uuid;
  }
  return null;
}
