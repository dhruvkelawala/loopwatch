import { capabilitiesFor } from '../core/capabilities.js';
import type { LivenessThresholds } from '../core/liveness.js';
import { TailingAdapter, type IngestFn } from '../core/tailing-adapter.js';
import { DEFAULT_CURSOR_DIR } from './cursor.js';
import { mapClaudeRecord, sessionIdFromPath } from './map.js';
import { CLAUDE_PROJECTS_ROOT, CLAUDE_SOURCE, PARSER_VERSION } from './types.js';

export type { IngestFn, ScanFileResult, ScanSummary } from '../core/tailing-adapter.js';
export { httpIngest } from '../core/tailing-adapter.js';

export interface ClaudeAdapterConfig {
  ingest: IngestFn;
  /** Transcript root. Default `~/.claude/projects`. */
  root?: string;
  /** Where transcript cursors are persisted. Default `data/cursors/claude`. */
  cursorDir?: string;
  thresholds?: LivenessThresholds;
  /**
   * Where to start a transcript with no cursor. `'end'` (default) tails only
   * new activity — it does not replay the hundreds of historical transcripts on
   * disk. `'start'` reads from the beginning (used by tests against fixtures).
   */
  initialAnchor?: 'start' | 'end';
  log?: (message: string, data?: unknown) => void;
}

/**
 * The Claude Code Source Adapter (issue #5), now a thin instantiation of the
 * shared {@link TailingAdapter} seam (issue #11). Claude writes one JSONL
 * transcript per session under `~/.claude/projects/<slug>/<sessionId>.jsonl`,
 * stamping `cwd` + `gitBranch` per record. The adapter supplies only Claude's
 * differences — its record→event mapping, filename→session-id rule, and
 * declared capabilities — and inherits the robust tail, idempotent cursor, and
 * liveness tracking from the core.
 */
export class ClaudeAdapter extends TailingAdapter {
  constructor(config: ClaudeAdapterConfig) {
    super({
      source: CLAUDE_SOURCE,
      ingest: config.ingest,
      root: config.root ?? CLAUDE_PROJECTS_ROOT,
      cursorDir: config.cursorDir ?? DEFAULT_CURSOR_DIR,
      parserVersion: PARSER_VERSION,
      mapRecord: mapClaudeRecord,
      sessionIdFromPath,
      capabilities: capabilitiesFor(CLAUDE_SOURCE),
      thresholds: config.thresholds,
      initialAnchor: config.initialAnchor,
      log: config.log,
    });
  }
}
