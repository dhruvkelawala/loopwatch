import type { ActorType, EventContext, LoopwatchEventInput } from '../../events.js';
import type { MapRecordOptions } from '../jsonl-source-adapter.js';
import { PI_SOURCE, type PiRecord } from './types.js';

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function actorType(value: unknown): ActorType | undefined {
  return value === 'user' || value === 'agent' || value === 'tool' || value === 'system' ? value : undefined;
}

function roleActor(role: unknown): ActorType | undefined {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'agent';
    case 'tool':
      return 'tool';
    case 'system':
      return 'system';
    default:
      return undefined;
  }
}

function piEventType(record: PiRecord): string {
  return stringValue(record.event) ?? stringValue(record.type) ?? 'unknown';
}

function classify(record: PiRecord): { kind: string; actorType: ActorType } {
  const eventType = piEventType(record);
  const nativeActor = actorType(recordValue(record.actor)?.type);
  const messageRole = roleActor(recordValue(record.message)?.role);

  if (eventType === 'message' || eventType === 'agent.message' || eventType === 'user.message') {
    return { kind: 'message', actorType: nativeActor ?? messageRole ?? 'agent' };
  }
  if (eventType === 'tool_call' || eventType === 'tool.call') return { kind: 'tool_call', actorType: nativeActor ?? 'agent' };
  if (eventType === 'tool_result' || eventType === 'tool.result' || eventType === 'validation.result') {
    return { kind: 'tool_result', actorType: nativeActor ?? 'tool' };
  }
  if (eventType === 'usage' || eventType === 'model_usage') return { kind: 'usage', actorType: nativeActor ?? 'system' };
  if (eventType === 'session' || eventType === 'session.started' || eventType === 'session.ended') {
    return { kind: 'session', actorType: nativeActor ?? 'system' };
  }
  if (eventType === 'model_change' || eventType === 'thinking_level_change' || eventType === 'custom') {
    return { kind: eventType, actorType: nativeActor ?? 'system' };
  }
  return { kind: eventType, actorType: nativeActor ?? messageRole ?? 'system' };
}

export function piSessionIdFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const withoutExt = base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base;
  const match = withoutExt.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? (withoutExt || 'unknown-pi-session');
}

export function mapPiRecord(record: PiRecord, options: MapRecordOptions): LoopwatchEventInput {
  const { kind, actorType } = classify(record);
  const worktree = recordValue(record.worktree);
  const inferred = options.inferredContext;

  const context: EventContext = {};
  const cwd = stringValue(record.cwd) ?? stringValue(worktree?.cwd) ?? stringValue(inferred?.cwd);
  const repo = stringValue(inferred?.repo);
  const branch = stringValue(worktree?.branch) ?? stringValue(inferred?.gitBranch);
  if (cwd) context.cwd = cwd;
  if (repo) context.repo = repo;
  if (branch) context.gitBranch = branch;

  return {
    source: PI_SOURCE,
    sessionId: stringValue(record.sessionId) ?? options.fileSessionId ?? 'unknown-pi-session',
    timestamp: stringValue(record.timestamp) ?? stringValue(record.ts) ?? new Date().toISOString(),
    kind,
    actor: { type: actorType },
    context,
    payload: record,
  };
}

export function lastPiRecordId(records: PiRecord[]): string | null {
  for (let index = records.length - 1; index >= 0; index--) {
    const id = stringValue(records[index].id);
    if (id) return id;
  }
  return null;
}
