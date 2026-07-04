import type { FlueEvent } from '@flue/sdk';
import { LoopwatchEventSchema, type LoopwatchEvent, type SessionConvergence } from './schemas/loopwatch.js';

export type { LoopwatchEvent, SessionConvergence } from './schemas/loopwatch.js';

export type Severity = 'intervention' | 'watch' | 'calm';
export type Liveness = 'active' | 'idle' | 'ended';
export type TimelineLaneName = 'request' | 'tools' | 'files' | 'git' | 'validation' | 'convergence';

export interface TimelineItem {
  id: string;
  at: string;
  label: string;
  tone: Severity | 'neutral';
  detail: string;
}

export interface TimelineLane {
  lane: TimelineLaneName;
  items: TimelineItem[];
}

export interface SessionView {
  id: string;
  source: string;
  title: string;
  repo: string;
  branch: string;
  goal: string;
  phase: string;
  severity: Severity;
  liveness: Liveness;
  elapsed: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  lastEvent: string;
  events: LoopwatchEvent[];
  lanes: TimelineLane[];
  convergence?: SessionConvergence;
}

const RECORDED_EVENT_MESSAGE = 'loopwatch.event.recorded';
const LIVENESS_IDLE_AFTER_MS = 5 * 60_000;
const LIVENESS_ENDED_AFTER_MS = 30 * 60_000;

const laneOrder: TimelineLaneName[] = ['request', 'tools', 'files', 'git', 'validation', 'convergence'];
const validationCommandPattern = /\b(test|verify|lint|typecheck|tsc|build|cargo\s+test|go\s+test|pytest|vitest|jest|playwright|cypress)\b/i;
const fileToolNames = new Set(['read', 'write', 'edit', 'multiedit', 'glob', 'grep', 'ls', 'todowrite']);

export function sessionKey(event: Pick<LoopwatchEvent, 'source' | 'sessionId'>): string {
  return `${event.source}:${event.sessionId}`;
}

export function recordedLoopwatchEvents(events: FlueEvent[]): LoopwatchEvent[] {
  const recorded: LoopwatchEvent[] = [];
  for (const event of events) {
    if (event.type !== 'log' || event.message !== RECORDED_EVENT_MESSAGE) continue;
    const parsed = LoopwatchEventSchema.safeParse(event.attributes);
    if (parsed.success) recorded.push(parsed.data);
  }
  return recorded;
}

export function dedupeLoopwatchEvents(events: LoopwatchEvent[]): LoopwatchEvent[] {
  const byKey = new Map<string, LoopwatchEvent>();
  for (const event of events) {
    byKey.set(eventFingerprint(event), event);
  }
  return [...byKey.values()].sort(compareEvents);
}

export function buildSessionViews(events: LoopwatchEvent[], nowMs: number = Date.now()): SessionView[] {
  const grouped = new Map<string, LoopwatchEvent[]>();
  for (const event of dedupeLoopwatchEvents(events)) {
    const key = sessionKey(event);
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .map(([id, sessionEvents]) => buildSessionView(id, sessionEvents.sort(compareEvents), nowMs))
    .sort((a, b) => {
      const byLiveness = livenessRank(a.liveness) - livenessRank(b.liveness);
      if (byLiveness !== 0) return byLiveness;
      return parseTime(b.lastSeen) - parseTime(a.lastSeen);
    });
}

export function buildTimelineLanes(events: LoopwatchEvent[]): TimelineLane[] {
  const itemsByLane = new Map<TimelineLaneName, TimelineItem[]>(laneOrder.map((lane) => [lane, []]));

  for (const event of events.sort(compareEvents)) {
    const lane = laneForEvent(event);
    if (lane === 'convergence') continue;
    itemsByLane.get(lane)?.push(timelineItemForEvent(event));
  }

  return laneOrder.map((lane) => ({ lane, items: itemsByLane.get(lane) ?? [] }));
}

function buildSessionView(id: string, events: LoopwatchEvent[], nowMs: number): SessionView {
  const first = events[0];
  const last = events.at(-1) ?? first;
  const title = titleForSession(events);
  const repo = latestString(events, (event) => event.context?.repo) ?? repoFromCwd(latestString(events, (event) => event.context?.cwd)) ?? 'unknown repo';
  const branch = latestString(events, (event) => event.context?.gitBranch) ?? 'unknown branch';
  const liveness = livenessForEvent(last, nowMs);

  return {
    id,
    source: sourceLabel(first?.source ?? 'unknown'),
    title,
    repo,
    branch,
    goal: openingRequest(events) ?? 'No user request recorded yet.',
    phase: phaseForEvent(last),
    severity: 'calm',
    liveness,
    elapsed: elapsedForSession(first, last, liveness, nowMs),
    eventCount: events.length,
    firstSeen: first?.timestamp ?? '',
    lastSeen: last?.timestamp ?? '',
    lastEvent: timelineItemForEvent(last).detail,
    events,
    lanes: buildTimelineLanes(events),
  };
}

function sourceLabel(source: string): string {
  if (source.toLowerCase() === 'claude') return 'Claude';
  if (source.toLowerCase() === 'codex') return 'Codex';
  if (source.toLowerCase() === 'pi') return 'Pi';
  return source;
}

function titleForSession(events: LoopwatchEvent[]): string {
  const aiTitle = latestString(events, (event) => {
    const payload = payloadRecord(event);
    return typeof payload?.aiTitle === 'string' ? payload.aiTitle : undefined;
  });
  if (aiTitle) return compact(aiTitle, 72);

  const request = openingRequest(events);
  if (request) return compact(request, 72);

  const first = events[0];
  return first ? `${sourceLabel(first.source)} session ${first.sessionId.slice(0, 8)}` : 'No session selected';
}

function openingRequest(events: LoopwatchEvent[]): string | undefined {
  const request = events.find((event) => event.kind === 'message' && event.actor.type === 'user');
  const text = request ? textFromEvent(request) : undefined;
  return text ? compact(text, 260) : undefined;
}

function latestString(events: LoopwatchEvent[], pick: (event: LoopwatchEvent) => string | undefined): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const value = pick(events[index]);
    if (value && value.length > 0) return value;
  }
  return undefined;
}

function repoFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.split('/').filter(Boolean);
  return parts.at(-1);
}

function livenessForEvent(event: LoopwatchEvent | undefined, nowMs: number): Liveness {
  if (!event) return 'ended';
  const last = parseTime(event.timestamp);
  if (!Number.isFinite(last)) return 'active';
  const age = Math.max(0, nowMs - last);
  if (age >= LIVENESS_ENDED_AFTER_MS) return 'ended';
  if (age >= LIVENESS_IDLE_AFTER_MS) return 'idle';
  return 'active';
}

function livenessRank(liveness: Liveness): number {
  if (liveness === 'active') return 0;
  if (liveness === 'idle') return 1;
  return 2;
}

function elapsedForSession(first: LoopwatchEvent | undefined, last: LoopwatchEvent | undefined, liveness: Liveness, nowMs: number): string {
  if (!first) return '—';
  const start = parseTime(first.timestamp);
  const end = liveness === 'active' ? nowMs : parseTime(last?.timestamp ?? first.timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  return formatDuration(Math.max(0, end - start));
}

function phaseForEvent(event: LoopwatchEvent | undefined): string {
  if (!event) return 'no events';
  if (event.kind === 'tool_call') return 'tool call';
  if (event.kind === 'tool_result') return 'tool result';
  if (event.kind === 'message' && event.actor.type === 'user') return 'awaiting agent';
  if (event.kind === 'message' && event.actor.type === 'agent') return 'agent response';
  if (event.kind === 'usage') return 'usage update';
  if (event.kind === 'system') return 'system';
  return event.kind;
}

function laneForEvent(event: LoopwatchEvent): TimelineLaneName {
  if (event.kind === 'message') return 'request';

  const toolName = toolNameFromEvent(event)?.toLowerCase();
  const command = bashCommandFromEvent(event);
  if (command && /^\s*git\b/i.test(command)) return 'git';
  if (command && validationCommandPattern.test(command)) return 'validation';
  if (toolName && fileToolNames.has(toolName)) return 'files';

  if (event.kind === 'tool_call' || event.kind === 'tool_result' || event.kind === 'system') return 'tools';
  return 'tools';
}

function timelineItemForEvent(event: LoopwatchEvent | undefined): TimelineItem {
  if (!event) {
    return { id: 'empty', at: '', label: 'No event', tone: 'neutral', detail: 'No source activity has been replayed yet.' };
  }

  const command = bashCommandFromEvent(event);
  const toolName = toolNameFromEvent(event);
  const text = textFromEvent(event);
  const label = labelForEvent(event, toolName);
  const detail = compact(command ?? text ?? event.kind, 280);

  return {
    id: eventFingerprint(event),
    at: event.timestamp,
    label,
    tone: toneForEvent(event),
    detail,
  };
}

function labelForEvent(event: LoopwatchEvent, toolName: string | undefined): string {
  if (event.kind === 'tool_call') return toolName ? `${toolName} call` : 'Tool call';
  if (event.kind === 'tool_result') return toolName ? `${toolName} result` : 'Tool result';
  if (event.kind === 'message' && event.actor.type === 'user') return 'User request';
  if (event.kind === 'message' && event.actor.type === 'agent') return 'Agent response';
  if (event.kind === 'system') return 'System event';
  return event.kind;
}

function toneForEvent(event: LoopwatchEvent): Severity | 'neutral' {
  if (event.kind === 'tool_result') return 'calm';
  if (event.kind === 'tool_call') return 'watch';
  if (event.kind === 'message') return event.actor.type === 'user' ? 'watch' : 'calm';
  return 'neutral';
}

function textFromEvent(event: LoopwatchEvent): string | undefined {
  const payload = payloadRecord(event);
  if (!payload) return undefined;

  if (typeof payload.content === 'string') return payload.content;
  const message = recordValue(payload.message);
  const content = message?.content;
  return textFromContent(content);
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const part of content) {
    const block = recordValue(part);
    if (!block) continue;
    if (typeof block.text === 'string') parts.push(block.text);
    else if (typeof block.content === 'string') parts.push(block.content);
    else if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool';
      const input = recordValue(block.input);
      const command = typeof input?.command === 'string' ? input.command : undefined;
      parts.push(command ? `${name}: ${command}` : `${name} call`);
    }
  }
  return parts.filter(Boolean).join('\n') || undefined;
}

function toolNameFromEvent(event: LoopwatchEvent): string | undefined {
  const block = firstToolUseBlock(event);
  if (typeof block?.name === 'string') return block.name;

  const payload = payloadRecord(event);
  if (typeof payload?.toolName === 'string') return payload.toolName;
  return undefined;
}

function bashCommandFromEvent(event: LoopwatchEvent): string | undefined {
  const block = firstToolUseBlock(event);
  const input = recordValue(block?.input);
  if (typeof input?.command === 'string') return input.command;
  return undefined;
}

function firstToolUseBlock(event: LoopwatchEvent): Record<string, unknown> | undefined {
  const payload = payloadRecord(event);
  const message = recordValue(payload?.message);
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;
  return content.map(recordValue).find((block) => block?.type === 'tool_use');
}

function payloadRecord(event: LoopwatchEvent): Record<string, unknown> | undefined {
  return recordValue(event.payload);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function eventFingerprint(event: LoopwatchEvent): string {
  const payload = payloadRecord(event);
  const uuid = typeof payload?.uuid === 'string' ? payload.uuid : undefined;
  if (uuid) return `${event.source}:${event.sessionId}:${uuid}`;
  return `${event.source}:${event.sessionId}:${event.timestamp}:${event.kind}:${event.actor.type}:${compact(textFromEvent(event) ?? '', 80)}`;
}

function compareEvents(a: LoopwatchEvent, b: LoopwatchEvent): number {
  const byTime = parseTime(a.timestamp) - parseTime(b.timestamp);
  if (byTime !== 0) return byTime;
  return eventFingerprint(a).localeCompare(eventFingerprint(b));
}

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
