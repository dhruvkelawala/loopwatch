import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { LoopwatchEventInput } from '../../events.js';
import type { EnrichBatch } from './tailing-adapter.js';

const exec = promisify(execFile);

/**
 * Inferred git context for a session's working directory (issue #11, ADR-0008).
 *
 * Some sources don't record the branch in their transcript — Pi records none at
 * all, and Codex only stamps it once in `session_meta`. For those, Loopwatch
 * infers repo + branch by reading the working tree directly. This is the same
 * independent ground truth ADR-0008 calls for: the git watcher is scoped to
 * active sessions, and a source's self-report is exactly the evidence that
 * can't always be trusted.
 *
 * `inferred: true` marks the values as observed-from-git, not source-reported,
 * so the Cockpit can stay honest about provenance. Because branch is per-event
 * derived context (ADR-0003) and not identity, reading the *current* branch for
 * an active session is an acceptable approximation, not a correctness risk.
 */
export interface GitContext {
  repo?: string;
  gitBranch?: string;
  inferred: boolean;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: GitContext }>();

async function gitField(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 2000 });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    // Not a git repo, git missing, detached HEAD, or the cwd is gone — all
    // resolve to "unknown", never an adapter failure.
    return undefined;
  }
}

/**
 * Resolve repo + branch for a working directory, cached per cwd with a short
 * TTL so an active session reflects a branch switch without spawning git on
 * every event.
 */
export async function resolveGitContext(cwd: string, now: number = Date.now()): Promise<GitContext> {
  const cached = cache.get(cwd);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const [toplevel, branch] = await Promise.all([
    gitField(cwd, ['rev-parse', '--show-toplevel']),
    gitField(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);

  const value: GitContext = {
    repo: toplevel ? (toplevel.split('/').filter(Boolean).at(-1) ?? undefined) : undefined,
    // A detached HEAD reports the literal "HEAD"; treat that as no branch.
    gitBranch: branch && branch !== 'HEAD' ? branch : undefined,
    inferred: true,
  };
  cache.set(cwd, { at: now, value });
  return value;
}

/** Clear the resolver cache (tests). */
export function resetGitContextCache(): void {
  cache.clear();
}

function firstCwd(events: LoopwatchEventInput[]): string | undefined {
  for (const event of events) {
    const cwd = event.context?.cwd;
    if (typeof cwd === 'string' && cwd.length > 0) return cwd;
  }
  return undefined;
}

function stringContext(event: LoopwatchEventInput, key: 'repo' | 'gitBranch'): string | undefined {
  const value = event.context?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * A batch enrich hook ({@link EnrichBatch}) that fills repo + branch context for
 * sources that don't fully record it in every record (issue #11, ADR-0008).
 *
 * Provenance is honest and source-truth wins:
 *   - A **source-reported** repo/branch (e.g. Codex's head `session_meta`) is
 *     remembered per file and propagated to the session's later records, which
 *     don't repeat it — never marked inferred.
 *   - Only when the source reports no branch at all (Pi) does it fall back to
 *     **git inference** from the session cwd, stamping `context.branchInferred =
 *     true` so the Cockpit can show the git-inferred provenance.
 *
 * The cwd is resolved per file — preferring a cwd already on a batch event, else
 * `headCwd(filePath)` (read from the transcript head) — and cached.
 */
export function gitEnrich(headCwd: (filePath: string) => Promise<string | undefined>): EnrichBatch {
  const cwdByFile = new Map<string, string | undefined>();
  const reportedByFile = new Map<string, { repo?: string; gitBranch?: string }>();

  return async (events, { filePath }) => {
    // Capture any source-reported repo/branch seen so far for this file.
    const reported = reportedByFile.get(filePath) ?? {};
    for (const event of events) {
      reported.repo ??= stringContext(event, 'repo');
      reported.gitBranch ??= stringContext(event, 'gitBranch');
    }
    reportedByFile.set(filePath, reported);

    // Resolve the session cwd (event-carried, else the transcript head), cached.
    const eventCwd = firstCwd(events);
    if (eventCwd && !cwdByFile.has(filePath)) cwdByFile.set(filePath, eventCwd);
    if (!cwdByFile.has(filePath)) cwdByFile.set(filePath, await headCwd(filePath));
    const cwd = eventCwd ?? cwdByFile.get(filePath);

    // Infer from git only when the source reports no branch at all.
    const needsInference = !reported.gitBranch || !reported.repo;
    const git = cwd && needsInference ? await resolveGitContext(cwd) : undefined;

    return events.map((event) => {
      const context: Record<string, unknown> = { ...(event.context ?? {}) };
      if (cwd && !context.cwd) context.cwd = cwd;

      if (!context.repo) {
        if (reported.repo) context.repo = reported.repo;
        else if (git?.repo) context.repo = git.repo;
      }
      if (!context.gitBranch) {
        if (reported.gitBranch) {
          // Source-reported branch, propagated — not inferred.
          context.gitBranch = reported.gitBranch;
        } else if (git?.gitBranch) {
          context.gitBranch = git.gitBranch;
          context.branchInferred = true;
        }
      }
      return { ...event, context };
    });
  };
}
