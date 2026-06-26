import { capabilitiesFor } from '../core/capabilities.js';
import { gitEnrich } from '../core/git-context.js';
import type { LivenessThresholds } from '../core/liveness.js';
import { TailingAdapter, type IngestFn } from '../core/tailing-adapter.js';
import { readFirstRecord } from '../core/transcript.js';
import { mapPiRecord, sessionIdFromPath } from './map.js';
import { PARSER_VERSION, PI_SESSIONS_ROOT, PI_SOURCE } from './types.js';

export type { IngestFn } from '../core/tailing-adapter.js';
export { httpIngest } from '../core/tailing-adapter.js';

export interface PiAdapterConfig {
  ingest: IngestFn;
  /** Sessions root. Default `~/.pi/agent/sessions`. */
  root?: string;
  /** Where session cursors are persisted. Default `data/cursors/pi`. */
  cursorDir?: string;
  thresholds?: LivenessThresholds;
  /** Where to start a session with no cursor. Default `'end'` (tail new activity). */
  initialAnchor?: 'start' | 'end';
  log?: (message: string, data?: unknown) => void;
}

/** Read the session's cwd from a Pi session head (`session` record `cwd`). */
async function headCwd(filePath: string): Promise<string | undefined> {
  const head = await readFirstRecord(filePath);
  const cwd = head?.cwd;
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
}

/**
 * The Pi (SumoCode) Source Adapter (issue #11), a thin instantiation of the
 * shared {@link TailingAdapter} seam. Pi records a direct `$` cost (in each
 * assistant message's `usage.cost.total`) but no git branch; the
 * {@link gitEnrich} hook resolves the session cwd from the `session` head and
 * infers repo + branch from git (ADR-0008), so a Pi session still gets honest
 * repo context — the issue's key acceptance criterion.
 */
export class PiAdapter extends TailingAdapter {
  constructor(config: PiAdapterConfig) {
    super({
      source: PI_SOURCE,
      ingest: config.ingest,
      root: config.root ?? PI_SESSIONS_ROOT,
      cursorDir: config.cursorDir,
      parserVersion: PARSER_VERSION,
      mapRecord: mapPiRecord,
      sessionIdFromPath,
      enrich: gitEnrich(headCwd),
      capabilities: capabilitiesFor(PI_SOURCE),
      thresholds: config.thresholds,
      initialAnchor: config.initialAnchor,
      log: config.log,
    });
  }
}
