/**
 * Claude transcript cursor — a thin binding over the shared core cursor
 * (issue #11). The generic cursor lives in `../core/cursor.ts`; this module
 * binds Claude's {@link PARSER_VERSION} and default directory so existing
 * call sites stay unchanged.
 */
import * as core from '../core/cursor.js';
import { PARSER_VERSION } from './types.js';

export type { TranscriptCursor, CursorLoad } from '../core/cursor.js';

/** Default on-disk location for Claude transcript cursors. */
export const DEFAULT_CURSOR_DIR = core.cursorDirFor('claude');

export function newCursor(path: string): core.TranscriptCursor {
  return core.newCursor(path, PARSER_VERSION);
}

export function loadCursor(dir: string, transcriptPath: string): Promise<core.CursorLoad> {
  return core.loadCursor(dir, transcriptPath, PARSER_VERSION);
}

export const saveCursor = core.saveCursor;
