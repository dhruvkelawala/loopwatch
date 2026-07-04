import type { IngestFn } from '../jsonl-source-adapter.js';
import type { LivenessThresholds } from '../claude/liveness.js';
import { JsonlSourceAdapter } from '../jsonl-source-adapter.js';
import { codexSessionIdFromPath, lastCodexRecordId, mapCodexRecord } from './map.js';
import { CODEX_CURSOR_DIR, CODEX_SESSIONS_ROOT, CODEX_SOURCE, type CodexRecord } from './types.js';

export interface CodexAdapterConfig {
  ingest: IngestFn;
  root?: string;
  cursorDir?: string;
  thresholds?: LivenessThresholds;
  initialAnchor?: 'start' | 'end';
  log?: (message: string, data?: unknown) => void;
}

export class CodexAdapter extends JsonlSourceAdapter<CodexRecord> {
  constructor(config: CodexAdapterConfig) {
    super({
      source: CODEX_SOURCE,
      ingest: config.ingest,
      root: config.root ?? CODEX_SESSIONS_ROOT,
      cursorDir: config.cursorDir ?? CODEX_CURSOR_DIR,
      thresholds: config.thresholds,
      initialAnchor: config.initialAnchor,
      log: config.log,
      mapRecord: mapCodexRecord,
      recordId: lastCodexRecordId,
      sessionIdFromPath: codexSessionIdFromPath,
    });
  }
}
