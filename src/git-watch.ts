import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import { sessionKey, type EventContext, type LoopwatchEvent } from './events.js';

export interface GitDiffSummary {
  files: number;
  insertions: number;
  deletions: number;
}

export interface GitCommitSummary {
  sha: string;
  subject: string;
  committedAt: string;
}

export type GitValidationStatus = 'passed' | 'failed' | 'unknown';

export interface GitValidationSummary {
  status: GitValidationStatus;
  detail: string;
  eventId?: string;
}

export interface GitEvidenceSnapshot {
  repoRoot: string;
  repo: string;
  branch: string;
  dirty: boolean;
  changedFiles: string[];
  diff: GitDiffSummary;
  head?: GitCommitSummary;
  validation: GitValidationSummary;
  sampledAt: string;
}

type GitRepositorySnapshot = Omit<GitEvidenceSnapshot, 'validation'>;

export interface ScopedGitWatcherConfig {
  nowMs?: number;
  activeAfterMs?: number;
  timeoutMs?: number;
}

const DEFAULT_ACTIVE_AFTER_MS = 5 * 60_000;
const DEFAULT_GIT_TIMEOUT_MS = 2_000;
const validationCommandPattern = /\b(test|verify|lint|typecheck|tsc|build|cargo\s+test|go\s+test|pytest|vitest|jest|playwright|cypress|harness|check)\b/i;

export function buildScopedGitEvidenceEvents(events: LoopwatchEvent[], config: ScopedGitWatcherConfig = {}): LoopwatchEvent[] {
  const nowMs = config.nowMs ?? Date.now();
  const activeAfterMs = config.activeAfterMs ?? DEFAULT_ACTIVE_AFTER_MS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const snapshotsByRoot = new Map<string, GitRepositorySnapshot | null>();
  const evidence: LoopwatchEvent[] = [];

  for (const [id, sessionEvents] of groupBySession(events)) {
    const ordered = sessionEvents.filter((event) => event.kind !== 'git').sort(compareEvents);
    const last = ordered.at(-1);
    if (!last || !sessionIsActive(last, nowMs, activeAfterMs)) continue;

    const cwd = latestString(ordered, (event) => event.context?.cwd);
    if (!cwd) continue;

    const repoRoot = resolveGitRoot(cwd, timeoutMs);
    if (!repoRoot) continue;

    const repoSnapshot = cachedGitSnapshot(repoRoot, snapshotsByRoot, timeoutMs, new Date(nowMs).toISOString());
    if (!repoSnapshot) continue;

    const snapshot: GitEvidenceSnapshot = {
      ...repoSnapshot,
      validation: validationSummaryForSession(ordered),
    };

    const context: EventContext = { cwd: snapshot.repoRoot, repo: snapshot.repo, gitBranch: snapshot.branch };
    evidence.push({
      source: last.source,
      sessionId: last.sessionId,
      timestamp: snapshot.sampledAt,
      kind: 'git',
      actor: { type: 'system', name: 'loopwatch-git-watcher' },
      context,
      payload: {
        id: gitEvidenceId(id, snapshot),
        git: snapshot,
      },
    });
  }

  return evidence;
}

export function gitSnapshotFromEvent(event: LoopwatchEvent): GitEvidenceSnapshot | undefined {
  if (event.kind !== 'git') return undefined;
  const payload = recordValue(event.payload);
  const git = recordValue(payload?.git);
  if (!git) return undefined;

  const repoRoot = stringValue(git.repoRoot);
  const repo = stringValue(git.repo);
  const branch = stringValue(git.branch);
  const sampledAt = stringValue(git.sampledAt);
  const changedFiles = Array.isArray(git.changedFiles) ? git.changedFiles.filter((item): item is string => typeof item === 'string') : undefined;
  const diffRecord = recordValue(git.diff);
  const validationRecord = recordValue(git.validation);
  if (!repoRoot || !repo || !branch || !sampledAt || !changedFiles || !diffRecord || !validationRecord) return undefined;

  const diff: GitDiffSummary = {
    files: numberValue(diffRecord.files) ?? changedFiles.length,
    insertions: numberValue(diffRecord.insertions) ?? 0,
    deletions: numberValue(diffRecord.deletions) ?? 0,
  };
  const validationStatus = stringValue(validationRecord.status);
  const validation: GitValidationSummary = {
    status: validationStatus === 'passed' || validationStatus === 'failed' ? validationStatus : 'unknown',
    detail: stringValue(validationRecord.detail) ?? 'No validation evidence observed',
    eventId: stringValue(validationRecord.eventId),
  };
  const headRecord = recordValue(git.head);
  const head = headRecord ? commitSummaryFromRecord(headRecord) : undefined;

  return {
    repoRoot,
    repo,
    branch,
    dirty: Boolean(git.dirty),
    changedFiles,
    diff,
    ...(head ? { head } : {}),
    validation,
    sampledAt,
  };
}

function cachedGitSnapshot(
  repoRoot: string,
  snapshotsByRoot: Map<string, GitRepositorySnapshot | null>,
  timeoutMs: number,
  sampledAt: string,
): GitRepositorySnapshot | null {
  let snapshot = snapshotsByRoot.get(repoRoot);
  if (snapshot === undefined) {
    snapshot = readGitSnapshot(repoRoot, timeoutMs, sampledAt);
    snapshotsByRoot.set(repoRoot, snapshot);
  }
  return snapshot;
}

function readGitSnapshot(repoRoot: string, timeoutMs: number, sampledAt: string): GitRepositorySnapshot | null {
  const statusOutput = git(repoRoot, ['status', '--porcelain=v1'], timeoutMs);
  if (statusOutput === undefined) return null;

  const changedFiles = parseChangedFiles(statusOutput);
  const diff = parseShortStat(git(repoRoot, ['diff', '--shortstat', 'HEAD', '--'], timeoutMs) ?? '');
  const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs)?.trim() || 'branch unavailable';
  const head = readHead(repoRoot, timeoutMs);

  return {
    repoRoot,
    repo: basename(repoRoot),
    branch: branch === 'HEAD' ? 'detached HEAD' : branch,
    dirty: changedFiles.length > 0,
    changedFiles,
    diff: {
      files: diff.files || changedFiles.length,
      insertions: diff.insertions,
      deletions: diff.deletions,
    },
    ...(head ? { head } : {}),
    sampledAt,
  };
}

function readHead(repoRoot: string, timeoutMs: number): GitCommitSummary | undefined {
  const output = git(repoRoot, ['log', '-1', '--format=%H%x00%s%x00%cI'], timeoutMs);
  if (!output) return undefined;
  const [sha, subject, committedAt] = output.trim().split('\0');
  return sha && subject && committedAt ? { sha, subject, committedAt } : undefined;
}

function resolveGitRoot(cwd: string, timeoutMs: number): string | undefined {
  return git(cwd, ['rev-parse', '--show-toplevel'], timeoutMs)?.trim() || undefined;
}

function git(cwd: string, args: string[], timeoutMs: number): string | undefined {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });
  } catch {
    return undefined;
  }
}

function parseChangedFiles(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).replace(/^.* -> /, ''))
    .sort();
}

function parseShortStat(output: string): GitDiffSummary {
  const files = numberFromMatch(output.match(/(\d+) files? changed/));
  const insertions = numberFromMatch(output.match(/(\d+) insertions?\(\+\)/));
  const deletions = numberFromMatch(output.match(/(\d+) deletions?\(-\)/));
  return { files, insertions, deletions };
}

function numberFromMatch(match: RegExpMatchArray | null): number {
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function validationSummaryForSession(events: LoopwatchEvent[]): GitValidationSummary {
  const validations = events.filter(isValidationEvent);
  const latest = validations.at(-1);
  if (!latest) return { status: 'unknown', detail: 'No validation evidence observed for this active session' };

  const exitCode = validationExitCode(latest);
  const command = commandFromEvent(latest) ?? 'validation result';
  if (exitCode === 0) return { status: 'passed', detail: `${compact(command, 120)} exited 0`, eventId: eventId(latest) };
  if (exitCode !== undefined) return { status: 'failed', detail: `${compact(command, 120)} exited ${exitCode}`, eventId: eventId(latest) };
  return { status: 'unknown', detail: compact(command, 140), eventId: eventId(latest) };
}

function isValidationEvent(event: LoopwatchEvent): boolean {
  const command = commandFromEvent(event) ?? '';
  if (validationCommandPattern.test(command)) return true;
  const payload = recordValue(event.payload);
  if (recordValue(payload?.validation) !== undefined) return true;
  return validationExitCode(event) !== undefined && contentBlocks(event).some((block) => block.type === 'tool_result');
}

function validationExitCode(event: LoopwatchEvent): number | undefined {
  const payload = recordValue(event.payload);
  const direct = numberValue(payload?.exitCode) ?? numberValue(recordValue(payload?.tool)?.exit_code) ?? numberValue(recordValue(payload?.validation)?.exitCode);
  if (direct !== undefined) return direct;
  const resultBlock = contentBlocks(event).find((block) => block.type === 'tool_result');
  if (typeof resultBlock?.is_error === 'boolean') return resultBlock.is_error ? 1 : 0;
  return undefined;
}

function commandFromEvent(event: LoopwatchEvent): string | undefined {
  const payload = recordValue(event.payload);
  if (!payload) return undefined;
  if (typeof payload.command === 'string') return payload.command;
  const tool = recordValue(payload.tool);
  if (typeof tool?.command === 'string') return tool.command;
  const validation = recordValue(payload.validation);
  if (typeof validation?.command === 'string') return validation.command;
  return undefined;
}

function contentBlocks(event: LoopwatchEvent): Record<string, unknown>[] {
  const payload = recordValue(event.payload);
  const message = recordValue(payload?.message);
  const content = message?.content ?? payload?.content;
  return Array.isArray(content) ? content.map(recordValue).filter((block): block is Record<string, unknown> => block !== undefined) : [];
}

function sessionIsActive(event: LoopwatchEvent, nowMs: number, activeAfterMs: number): boolean {
  const timestamp = Date.parse(event.timestamp);
  return Number.isFinite(timestamp) && nowMs - timestamp <= activeAfterMs;
}

function groupBySession(events: LoopwatchEvent[]): Map<string, LoopwatchEvent[]> {
  const grouped = new Map<string, LoopwatchEvent[]>();
  for (const event of events) {
    const key = sessionKey(event);
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return grouped;
}

function latestString(events: LoopwatchEvent[], selector: (event: LoopwatchEvent) => string | undefined): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const value = selector(events[index]!);
    if (value) return value;
  }
  return undefined;
}

function gitEvidenceId(sessionId: string, snapshot: GitEvidenceSnapshot): string {
  const fingerprint = JSON.stringify({
    sessionId,
    repoRoot: snapshot.repoRoot,
    branch: snapshot.branch,
    changedFiles: snapshot.changedFiles,
    diff: snapshot.diff,
    head: snapshot.head?.sha,
    validation: snapshot.validation,
  });
  return `git:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)}`;
}

function eventId(event: LoopwatchEvent): string {
  const payload = recordValue(event.payload);
  const record = event as Record<string, unknown>;
  return stringValue(payload?.id) ?? stringValue(record.id) ?? stringValue(record.uuid) ?? `${event.source}:${event.sessionId}:${event.timestamp}:${event.kind}`;
}

function commitSummaryFromRecord(record: Record<string, unknown>): GitCommitSummary | undefined {
  const sha = stringValue(record.sha);
  const subject = stringValue(record.subject);
  const committedAt = stringValue(record.committedAt);
  return sha && subject && committedAt ? { sha, subject, committedAt } : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function compareEvents(a: LoopwatchEvent, b: LoopwatchEvent): number {
  const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp);
  if (byTime !== 0) return byTime;
  return eventId(a).localeCompare(eventId(b));
}
