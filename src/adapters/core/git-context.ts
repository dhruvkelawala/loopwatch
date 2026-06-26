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

/**
 * A batch enrich hook ({@link EnrichBatch}) that fills repo + branch context
 * from git for sources that don't fully record it in their transcript (issue
 * #11, ADR-0008). It resolves the session's cwd — preferring a cwd already on a
 * batch event, else `headCwd(filePath)` (e.g. read from the transcript head),
 * cached per file — then stamps every event with:
 *   - `context.cwd`           when missing
 *   - `context.repo`          inferred repo (basename of the git toplevel)
 *   - `context.gitBranch`     inferred current branch, plus
 *   - `context.branchInferred = true` so the Cockpit stays honest about
 *                             provenance (source-reported vs git-inferred).
 *
 * Source-reported values are never overwritten; only gaps are filled.
 */
export function gitEnrich(headCwd: (filePath: string) => Promise<string | undefined>): EnrichBatch {
  const cwdByFile = new Map<string, string | undefined>();

  return async (events, { filePath }) => {
    const eventCwd = firstCwd(events);
    if (eventCwd && !cwdByFile.has(filePath)) cwdByFile.set(filePath, eventCwd);
    if (!cwdByFile.has(filePath)) cwdByFile.set(filePath, await headCwd(filePath));
    const cwd = eventCwd ?? cwdByFile.get(filePath);
    if (!cwd) return events;

    const git = await resolveGitContext(cwd);
    return events.map((event) => {
      const context: Record<string, unknown> = { ...(event.context ?? {}) };
      if (!context.cwd) context.cwd = cwd;
      if (git.repo && !context.repo) context.repo = git.repo;
      if (git.gitBranch && !context.gitBranch) {
        context.gitBranch = git.gitBranch;
        context.branchInferred = true;
      }
      return { ...event, context };
    });
  };
}
