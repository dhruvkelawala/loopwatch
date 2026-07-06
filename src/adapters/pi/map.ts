import type { ActorType, EventContext, LoopwatchEventInput } from '../../events.js';
import type { MapContext } from '../core/tailing-adapter.js';
import { PI_SOURCE, type PiRecord } from './types.js';

/**
 * Map a raw Pi session record to a normalized Loopwatch Event (ADR-0004).
 *
 * One record → one event. The typed `type` (and, for messages, `message.role`
 * + content blocks) decide `kind` + `actor`; the full raw record is preserved
 * verbatim as `payload` (no-drop), so the UI can read Pi's `usage.cost.total`
 * without the mapper modeling it. Session identity is `(pi, sessionId)`
 * (ADR-0003), where the session id is the filename's trailing UUID — per-record
 * `id` fields are message ids, not the session id.
 */

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Derive the session id from a `<timestamp>_<uuid>.jsonl` filename. */
export function sessionIdFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const name = base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base;
  const match = name.match(UUID_RE);
  if (match) return match[1];
  // No UUID (unexpected): fall back to the part after the last `_`, else the
  // bare name, so the event still has a non-empty identity.
  const tail = name.split('_').at(-1);
  return tail && tail.length > 0 ? tail : name;
}

function contentBlocks(record: PiRecord): Array<Record<string, unknown>> {
  const content = record.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => !!block && typeof block === 'object');
}

function hasBlockType(record: PiRecord, blockType: string): boolean {
  return contentBlocks(record).some((block) => block.type === blockType);
}

/** Decide event kind + actor from the record type and message role. */
function classify(record: PiRecord): { kind: string; actorType: ActorType } {
  switch (record.type) {
    case 'message': {
      const role = record.message?.role;
      if (role === 'user') return { kind: 'message', actorType: 'user' };
      if (role === 'assistant') {
        // An assistant turn that calls a tool vs. one that just speaks.
        return hasBlockType(record, 'toolCall')
          ? { kind: 'tool_call', actorType: 'agent' }
          : { kind: 'message', actorType: 'agent' };
      }
      if (role === 'toolResult' || role === 'bashExecution') return { kind: 'tool_result', actorType: 'tool' };
      // Unknown role: preserve it as a message from the system actor.
      return { kind: 'message', actorType: 'system' };
    }
    case 'session':
    case 'compaction':
      return { kind: 'session', actorType: 'system' };
    case 'model_change':
    case 'thinking_level_change':
    case 'custom':
    case 'custom_message':
      // Pi's config/diagnostic stream — its declared `diagnostics` capability.
      return { kind: 'diagnostic', actorType: 'system' };
    default:
      // Unknown/native record type: preserve it verbatim as the kind (ADR-0004).
      return {
        kind: typeof record.type === 'string' && record.type.length > 0 ? record.type : 'unknown',
        actorType: 'system',
      };
  }
}

/** Per-event context. Only the head `session` record carries cwd; git is inferred. */
function contextFor(record: PiRecord): EventContext {
  const context: Record<string, unknown> = {};
  if (typeof record.cwd === 'string') context.cwd = record.cwd;
  return context as EventContext;
}

export function mapPiRecord(record: PiRecord, context: MapContext): LoopwatchEventInput {
  const { kind, actorType } = classify(record);

  return {
    source: PI_SOURCE,
    sessionId: context.fileSessionId && context.fileSessionId.length > 0 ? context.fileSessionId : 'unknown-session',
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString(),
    kind,
    actor: { type: actorType },
    context: contextFor(record),
    // Full raw record — the no-drop guarantee. Carries `message.usage.cost`.
    payload: record,
  };
}
