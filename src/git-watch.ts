import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import { sessionKey, type EventContext, type LoopwatchEvent } from './events.js';
import { commandFromEvent, isValidationEvent, validationExitCode, validationToolUseIds } from './validation-evidence.js';

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
  /**
   * Reuse repo snapshots (and cwd→root resolutions) across calls for this many
   * ms of wall-clock time. `0` (default) disables reuse — deterministic checks
   * mutate fixture repos between calls and must observe every change. The
   * convergence endpoint sets this to skip re-running the git chain on every
   * 2s UI poll.
   */
  cacheTtlMs?: number;
}

const DEFAULT_ACTIVE_AFTER_MS = 5 * 60_000;
const DEFAULT_GIT_TIMEOUT_MS = 2_000;

const execFileAsync = promisify(execFile);
const rootByCwd = new Map<string, { root: string | undefined; expiresAtMs: number }>();
const snapshotByRoot = new Map<string, { snapshot: GitRepositorySnapshot | null; expiresAtMs: number }>();

export async function buildScopedGitEvidenceEvents(events: LoopwatchEvent[], config: ScopedGitWatcherConfig = {}): Promise<LoopwatchEvent[]> {
  const nowMs = config.nowMs ?? Date.now();
  const activeAfterMs = config.activeAfterMs ?? DEFAULT_ACTIVE_AFTER_MS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const cacheTtlMs = config.cacheTtlMs ?? 0;
  const snapshotsByRoot = new Map<string, Promise<GitRepositorySnapshot | null>>();

  const evidence = await Promise.all(
    [...groupBySession(events)].map(async ([id, sessionEvents]): Promise<LoopwatchEvent | undefined> => {
      const ordered = sessionEvents.filter((event) => event.kind !== 'git').sort(compareEvents);
      const last = ordered.at(-1);
      if (!last || !sessionIsActive(last, nowMs, activeAfterMs)) return undefined;

      const cwd = latestString(ordered, (event) => event.context?.cwd);
      if (!cwd) return undefined;

      const repoRoot = await resolveGitRoot(cwd, timeoutMs, cacheTtlMs);
      if (!repoRoot) return undefined;

      const repoSnapshot = await cachedGitSnapshot(repoRoot, snapshotsByRoot, timeoutMs, new Date(nowMs).toISOString(), cacheTtlMs);
      if (!repoSnapshot) return undefined;

      const snapshot: GitEvidenceSnapshot = {
        ...repoSnapshot,
        validation: validationSummaryForSession(ordered),
      };

      const context: EventContext = { cwd: snapshot.repoRoot, repo: snapshot.repo, gitBranch: snapshot.branch };
      return {
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
      };
    }),
  );

  return evidence.filter((event): event is LoopwatchEvent => event !== undefined);
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
  snapshotsByRoot: Map<string, Promise<GitRepositorySnapshot | null>>,
  timeoutMs: number,
  sampledAt: string,
  cacheTtlMs: number,
): Promise<GitRepositorySnapshot | null> {
  let pending = snapshotsByRoot.get(repoRoot);
  if (pending === undefined) {
    if (cacheTtlMs > 0) {
      const cached = snapshotByRoot.get(repoRoot);
      if (cached && cached.expiresAtMs > Date.now()) return Promise.resolve(cached.snapshot);
    }
    pending = readGitSnapshot(repoRoot, timeoutMs, sampledAt).then((snapshot) => {
      if (cacheTtlMs > 0) snapshotByRoot.set(repoRoot, { snapshot, expiresAtMs: Date.now() + cacheTtlMs });
      return snapshot;
    });
    snapshotsByRoot.set(repoRoot, pending);
  }
  return pending;
}

async function readGitSnapshot(repoRoot: string, timeoutMs: number, sampledAt: string): Promise<GitRepositorySnapshot | null> {
  const [statusOutput, diffOutput, branchOutput, head] = await Promise.all([
    git(repoRoot, ['status', '--porcelain=v1'], timeoutMs),
    git(repoRoot, ['diff', '--shortstat', 'HEAD', '--'], timeoutMs),
    git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs),
    readHead(repoRoot, timeoutMs),
  ]);
  if (statusOutput === undefined) return null;

  const changedFiles = parseChangedFiles(statusOutput);
  const diff = parseShortStat(diffOutput ?? '');
  const branch = branchOutput?.trim() || 'branch unavailable';

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

async function readHead(repoRoot: string, timeoutMs: number): Promise<GitCommitSummary | undefined> {
  const output = await git(repoRoot, ['log', '-1', '--format=%H%x00%s%x00%cI'], timeoutMs);
  if (!output) return undefined;
  const [sha, subject, committedAt] = output.trim().split('\0');
  return sha && subject && committedAt ? { sha, subject, committedAt } : undefined;
}

async function resolveGitRoot(cwd: string, timeoutMs: number, cacheTtlMs: number): Promise<string | undefined> {
  if (cacheTtlMs > 0) {
    const cached = rootByCwd.get(cwd);
    if (cached && cached.expiresAtMs > Date.now()) return cached.root;
  }
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], timeoutMs))?.trim() || undefined;
  if (cacheTtlMs > 0) rootByCwd.set(cwd, { root, expiresAtMs: Date.now() + cacheTtlMs });
  return root;
}

async function git(cwd: string, args: string[], timeoutMs: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    return stdout;
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
  const validationIds = validationToolUseIds(events);
  const validations = events.filter((event) => isValidationEvent(event, validationIds));
  const latest = validations.at(-1);
  if (!latest) return { status: 'unknown', detail: 'No validation evidence observed for this active session' };

  const exitCode = validationExitCode(latest);
  const command = commandFromEvent(latest) ?? 'validation result';
  if (exitCode === 0) return { status: 'passed', detail: `${compact(command, 120)} exited 0`, eventId: eventId(latest) };
  if (exitCode !== undefined) return { status: 'failed', detail: `${compact(command, 120)} exited ${exitCode}`, eventId: eventId(latest) };
  return { status: 'unknown', detail: compact(command, 140), eventId: eventId(latest) };
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
