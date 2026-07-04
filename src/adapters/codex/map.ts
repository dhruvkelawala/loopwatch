import type { ActorType, EventContext, LoopwatchEventInput } from '../../events.js';
import type { MapContext } from '../core/tailing-adapter.js';
import { CODEX_SOURCE, type CodexRecord } from './types.js';

/**
 * Map a raw Codex rollout record to a normalized Loopwatch Event (ADR-0004).
 *
 * One record → one event. The envelope `type` + `payload.type` decide `kind` +
 * `actor`; the full raw record is preserved verbatim as `payload` (no-drop).
 * Session identity is `(codex, sessionId)` (ADR-0003), where the session id is
 * the rollout filename's trailing UUID — individual records (other than the
 * head `session_meta`) don't carry it, so the filename is the stable key.
 */

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Derive the session id from a `rollout-<ts>-<uuid>.jsonl` filename. */
export function sessionIdFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const name = base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base;
  const match = name.match(UUID_RE);
  if (match) return match[1];
  // No UUID in the name (unexpected): fall back to the bare filename so the
  // event still has a non-empty identity rather than poisoning the batch.
  return name.replace(/^rollout-/, '') || name;
}

function payloadType(payload: Record<string, unknown> | null | undefined): string | undefined {
  return payload && typeof payload.type === 'string' ? payload.type : undefined;
}

/** Decide event kind + actor from the envelope type and payload type/role. */
function classify(record: CodexRecord): { kind: string; actorType: ActorType } {
  const payload = record.payload ?? undefined;
  const pType = payloadType(payload);

  switch (record.type) {
    case 'response_item':
      switch (pType) {
        case 'message': {
          const role = payload && typeof payload.role === 'string' ? payload.role : undefined;
          if (role === 'user') return { kind: 'message', actorType: 'user' };
          if (role === 'assistant') return { kind: 'message', actorType: 'agent' };
          // developer / system prompt scaffolding.
          return { kind: 'message', actorType: 'system' };
        }
        case 'function_call':
        case 'custom_tool_call':
        case 'web_search_call':
          return { kind: 'tool_call', actorType: 'agent' };
        case 'function_call_output':
        case 'custom_tool_call_output':
          return { kind: 'tool_result', actorType: 'tool' };
        case 'reasoning':
          return { kind: 'reasoning', actorType: 'agent' };
        default:
          return { kind: pType ?? 'response_item', actorType: 'system' };
      }
    case 'event_msg':
      switch (pType) {
        case 'user_message':
          return { kind: 'message', actorType: 'user' };
        case 'agent_message':
          return { kind: 'message', actorType: 'agent' };
        case 'token_count':
          return { kind: 'usage', actorType: 'system' };
        case 'exec_command_end':
        case 'patch_apply_end':
        case 'web_search_end':
        case 'mcp_tool_call_end':
        case 'view_image_tool_call':
          return { kind: 'tool_result', actorType: 'tool' };
        case 'task_started':
        case 'task_complete':
        case 'turn_aborted':
        case 'context_compacted':
          return { kind: 'session', actorType: 'system' };
        default:
          return { kind: pType ?? 'event_msg', actorType: 'system' };
      }
    case 'session_meta':
    case 'turn_context':
    case 'compacted':
      return { kind: 'session', actorType: 'system' };
    default:
      // Unknown/native envelope type: preserve it verbatim as the kind (ADR-0004).
      return {
        kind: typeof record.type === 'string' && record.type.length > 0 ? record.type : 'unknown',
        actorType: 'system',
      };
  }
}

/** Repo name from a remote URL like `https://github.com/org/repo(.git)`. */
export function repoFromUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length === 0) return undefined;
  const trimmed = url.replace(/\.git$/, '').replace(/\/$/, '');
  const last = trimmed.split('/').filter(Boolean).at(-1);
  return last && last.length > 0 ? last : undefined;
}

/** Pull per-event context (cwd / branch / repo) from the records that carry it. */
function contextFor(record: CodexRecord): EventContext {
  const payload = record.payload ?? {};
  const context: Record<string, unknown> = {};

  if (typeof payload.cwd === 'string') context.cwd = payload.cwd;

  const git = payload.git;
  if (git && typeof git === 'object') {
    const gitRecord = git as Record<string, unknown>;
    if (typeof gitRecord.branch === 'string') context.gitBranch = gitRecord.branch;
    const repo = repoFromUrl(gitRecord.repository_url);
    if (repo) context.repo = repo;
  }

  // Codex model + cli version are useful per-event context extras (no-drop).
  if (typeof payload.model === 'string') context.model = payload.model;
  if (typeof payload.cli_version === 'string') context.sourceVersion = payload.cli_version;

  return context as EventContext;
}

export function mapCodexRecord(record: CodexRecord, context: MapContext): LoopwatchEventInput {
  const { kind, actorType } = classify(record);

  return {
    source: CODEX_SOURCE,
    // Identity is the filename UUID (records don't repeat the session id).
    sessionId: context.fileSessionId && context.fileSessionId.length > 0 ? context.fileSessionId : 'unknown-session',
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString(),
    kind,
    actor: { type: actorType },
    context: contextFor(record),
    // Full raw record — the no-drop guarantee.
    payload: record,
  };
}
