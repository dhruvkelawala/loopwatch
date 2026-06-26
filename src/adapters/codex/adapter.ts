import { capabilitiesFor } from '../core/capabilities.js';
import { gitEnrich, type HeadContext } from '../core/git-context.js';
import type { LivenessThresholds } from '../core/liveness.js';
import { TailingAdapter, type IngestFn } from '../core/tailing-adapter.js';
import { readFirstRecord } from '../core/transcript.js';
import { mapCodexRecord, repoFromUrl, sessionIdFromPath } from './map.js';
import { CODEX_SESSIONS_ROOT, CODEX_SOURCE, isRolloutFile, PARSER_VERSION } from './types.js';

export type { IngestFn } from '../core/tailing-adapter.js';
export { httpIngest } from '../core/tailing-adapter.js';

export interface CodexAdapterConfig {
  ingest: IngestFn;
  /** Rollout root. Default `~/.codex/sessions`. */
  root?: string;
  /** Where rollout cursors are persisted. Default `data/cursors/codex`. */
  cursorDir?: string;
  thresholds?: LivenessThresholds;
  /** Where to start a rollout with no cursor. Default `'end'` (tail new activity). */
  initialAnchor?: 'start' | 'end';
  log?: (message: string, data?: unknown) => void;
}

/**
 * Read the session's source-reported context from a rollout head
 * (`session_meta.payload`): cwd + git branch / repo. In tail-from-end mode the
 * head is seeded past, so this recovers the source-reported git rather than
 * letting it fall back to working-tree inference.
 */
async function readHead(filePath: string): Promise<HeadContext | undefined> {
  const head = await readFirstRecord(filePath);
  const payload = head?.payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;

  const context: HeadContext = {};
  if (typeof record.cwd === 'string' && record.cwd.length > 0) context.cwd = record.cwd;
  const git = record.git;
  if (git && typeof git === 'object') {
    const gitRecord = git as Record<string, unknown>;
    if (typeof gitRecord.branch === 'string' && gitRecord.branch.length > 0) context.gitBranch = gitRecord.branch;
    const repo = repoFromUrl(gitRecord.repository_url);
    if (repo) context.repo = repo;
  }
  return context;
}

/**
 * The Codex Source Adapter (issue #11), a thin instantiation of the shared
 * {@link TailingAdapter} seam. Codex stamps cwd + git only on its head
 * `session_meta`; the {@link gitEnrich} hook recovers cwd from the head and
 * fills repo + branch from git for the records that lack it (ADR-0008), so a
 * session tailed from the end still gets honest repo context.
 */
export class CodexAdapter extends TailingAdapter {
  constructor(config: CodexAdapterConfig) {
    super({
      source: CODEX_SOURCE,
      ingest: config.ingest,
      root: config.root ?? CODEX_SESSIONS_ROOT,
      cursorDir: config.cursorDir,
      parserVersion: PARSER_VERSION,
      mapRecord: mapCodexRecord,
      sessionIdFromPath,
      accept: isRolloutFile,
      enrich: gitEnrich(readHead),
      capabilities: capabilitiesFor(CODEX_SOURCE),
      thresholds: config.thresholds,
      initialAnchor: config.initialAnchor,
      log: config.log,
    });
  }
}
