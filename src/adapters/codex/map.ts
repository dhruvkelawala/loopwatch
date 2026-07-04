import type { ActorType, EventContext, LoopwatchEventInput } from '../../events.js';
import type { MapRecordOptions } from '../jsonl-source-adapter.js';
import { CODEX_SOURCE, type CodexRecord } from './types.js';

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nativePayload(record: CodexRecord): Record<string, unknown> | undefined {
  return recordValue(record.payload);
}

function codexRole(record: CodexRecord): string | undefined {
  return stringValue(record.role) ?? stringValue(nativePayload(record)?.role);
}

function actorTypeFromRole(role: string | undefined): ActorType {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'agent';
    case 'tool':
      return 'tool';
    case 'developer':
    case 'system':
    default:
      return 'system';
  }
}

function classify(record: CodexRecord): { kind: string; actorType: ActorType } {
  const type = stringValue(record.type) ?? 'unknown';
  const payload = nativePayload(record);
  const payloadType = stringValue(payload?.type);
  const role = codexRole(record);

  if (type === 'turn') return { kind: 'message', actorType: actorTypeFromRole(role) };
  if (type === 'tool_call') return { kind: 'tool_call', actorType: 'agent' };
  if (type === 'tool_result') return { kind: 'tool_result', actorType: 'tool' };
  if (type === 'usage') return { kind: 'usage', actorType: 'system' };
  if (type === 'session_meta') return { kind: 'session', actorType: 'system' };

  if (type === 'response_item') {
    if (payloadType === 'message') return { kind: 'message', actorType: actorTypeFromRole(role) };
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') return { kind: 'tool_call', actorType: 'agent' };
    if (payloadType === 'function_call_output') return { kind: 'tool_result', actorType: 'tool' };
    return { kind: payloadType ?? type, actorType: actorTypeFromRole(role) };
  }

  if (type === 'event_msg') {
    return { kind: payloadType ?? 'system', actorType: 'system' };
  }

  return { kind: type, actorType: actorTypeFromRole(role) };
}

export function codexSessionIdFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const withoutExt = base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base;
  const match = withoutExt.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? (withoutExt.replace(/^rollout-/, '') || 'unknown-codex-session');
}

export function mapCodexRecord(record: CodexRecord, options: MapRecordOptions): LoopwatchEventInput {
  const payload = nativePayload(record);
  const sessionId =
    stringValue(record.session_id) ??
    stringValue(record.sessionId) ??
    stringValue(payload?.session_id) ??
    stringValue(payload?.sessionId) ??
    options.fileSessionId ??
    'unknown-codex-session';
  const { kind, actorType } = classify(record);

  const context: EventContext = {};
  const cwd = stringValue(record.cwd) ?? stringValue(payload?.cwd);
  if (cwd) context.cwd = cwd;
  if (stringValue(payload?.cli_version)) (context as Record<string, unknown>).sourceVersion = payload?.cli_version;
  if (stringValue(payload?.originator)) (context as Record<string, unknown>).originator = payload?.originator;
  if (stringValue(payload?.model_provider)) (context as Record<string, unknown>).modelProvider = payload?.model_provider;

  return {
    source: CODEX_SOURCE,
    sessionId,
    timestamp: stringValue(record.timestamp) ?? stringValue(payload?.timestamp) ?? new Date().toISOString(),
    kind,
    actor: { type: actorType },
    context,
    payload: record,
  };
}

export function lastCodexRecordId(records: CodexRecord[]): string | null {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    const payload = nativePayload(record);
    const id = stringValue(record.id) ?? stringValue(payload?.id) ?? stringValue(payload?.turn_id);
    if (id) return id;
  }
  return null;
}
