import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import type { IngestFn } from '../jsonl-source-adapter.js';
import type { LivenessThresholds } from '../claude/liveness.js';
import { JsonlSourceAdapter } from '../jsonl-source-adapter.js';
import { lastPiRecordId, mapPiRecord, piSessionIdFromPath } from './map.js';
import { PI_CURSOR_DIR, PI_SESSIONS_ROOT, PI_SOURCE, type PiRecord } from './types.js';

const GIT_INFERENCE_TIMEOUT_MS = 2_000;
const gitContextCache = new Map<string, Record<string, unknown>>();

export interface PiAdapterConfig {
  ingest: IngestFn;
  root?: string;
  cursorDir?: string;
  thresholds?: LivenessThresholds;
  initialAnchor?: 'start' | 'end';
  log?: (message: string, data?: unknown) => void;
}

export class PiAdapter extends JsonlSourceAdapter<PiRecord> {
  constructor(config: PiAdapterConfig) {
    super({
      source: PI_SOURCE,
      ingest: config.ingest,
      root: config.root ?? PI_SESSIONS_ROOT,
      cursorDir: config.cursorDir ?? PI_CURSOR_DIR,
      thresholds: config.thresholds,
      initialAnchor: config.initialAnchor,
      log: config.log,
      mapRecord: mapPiRecord,
      recordId: lastPiRecordId,
      sessionIdFromPath: piSessionIdFromPath,
      inferContext: inferPiContext,
    });
  }
}

function inferPiContext(records: PiRecord[]): Record<string, unknown> | undefined {
  const cwd = firstCwd(records);
  if (!cwd) return undefined;
  const cached = gitContextCache.get(cwd);
  if (cached) return { ...cached };

  const context: Record<string, unknown> = { cwd };
  try {
    const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_INFERENCE_TIMEOUT_MS,
    }).trim();
    if (root) context.repo = basename(root);
  } catch {
    context.repo = basename(cwd);
  }

  try {
    const branch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_INFERENCE_TIMEOUT_MS,
    }).trim();
    if (branch && branch !== 'HEAD') context.gitBranch = branch;
  } catch {
    // Pi does not carry branch in-transcript. Missing branch stays unavailable.
  }

  gitContextCache.set(cwd, { ...context });

  return context;
}

function firstCwd(records: PiRecord[]): string | undefined {
  for (const record of records) {
    if (typeof record.cwd === 'string' && record.cwd.length > 0) return record.cwd;
    const worktree = record.worktree;
    if (worktree && typeof worktree === 'object' && !Array.isArray(worktree)) {
      const cwd = (worktree as Record<string, unknown>).cwd;
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    }
  }
  return undefined;
}
