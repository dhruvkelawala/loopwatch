import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Idempotent per-transcript file cursor, shared by every Source Adapter
 * (issue #5, generalized for issue #11).
 *
 * Persists enough to resume tailing exactly where we left off, without
 * re-emitting committed records across restarts:
 *   - `path`          — the transcript this cursor tracks
 *   - `fileId`        — inode / stable file id, to detect path reuse or rotation
 *   - `byteOffset`    — resume point; only advanced after a record is committed
 *   - `lastUuid`      — last committed record id, for cross-checking
 *   - `parserVersion` — guards a resumed offset against a mapping change
 *
 * Cursors are written atomically (temp file + rename) so a crash mid-write
 * never corrupts the resume point. The `parserVersion` is supplied by each
 * adapter so a source can bump its mapper independently.
 */
export interface TranscriptCursor {
  path: string;
  fileId: string | null;
  byteOffset: number;
  lastUuid: string | null;
  parserVersion: number;
}

/** Default on-disk cursor directory for a source, e.g. `data/cursors/codex`. */
export function cursorDirFor(source: string): string {
  return join('data', 'cursors', source);
}

function cursorFile(dir: string, transcriptPath: string): string {
  // Hash the path to a fixed-length, filesystem-safe key. A verbatim base64url
  // encoding of a deep project path can exceed the 255-byte filename limit
  // (ENAMETOOLONG), which would make that transcript silently never persist a
  // cursor. The full path is still recorded inside the cursor JSON.
  const hash = createHash('sha256').update(transcriptPath).digest('hex');
  return join(dir, `${hash}.json`);
}

export function newCursor(path: string, parserVersion: number): TranscriptCursor {
  return { path, fileId: null, byteOffset: 0, lastUuid: null, parserVersion };
}

/**
 * Result of loading a cursor. The three cases must stay distinct so the caller
 * can tell a brand-new transcript (seed per the initial anchor) apart from an
 * invalidated cursor (re-read from offset 0, never re-seed to end).
 */
export type CursorLoad =
  | { status: 'missing' }
  | { status: 'invalidated' }
  | { status: 'loaded'; cursor: TranscriptCursor };

export async function loadCursor(dir: string, transcriptPath: string, parserVersion: number): Promise<CursorLoad> {
  try {
    const raw = await readFile(cursorFile(dir, transcriptPath), 'utf8');
    const parsed = JSON.parse(raw) as TranscriptCursor;
    // A parser-version mismatch means a resumed offset could emit different
    // events than when it was written; signal invalidation so the caller
    // re-reads from the start rather than skipping to end.
    if (parsed.parserVersion !== parserVersion) return { status: 'invalidated' };
    return { status: 'loaded', cursor: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
}

export async function saveCursor(dir: string, cursor: TranscriptCursor): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = cursorFile(dir, cursor.path);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cursor), 'utf8');
  await rename(tmp, target);
}
