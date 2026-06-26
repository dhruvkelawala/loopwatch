import type { Stats } from 'node:fs';
import { open, opendir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { TranscriptCursor } from './cursor.js';

/**
 * Generic JSONL-transcript tailing primitives, shared by every Source Adapter
 * (issue #11). The Claude adapter (issue #5) was the first consumer; these
 * helpers are source-agnostic so Codex and Pi reuse exactly the same robust
 * tail (partial-line holding, rotation re-anchoring, corrupt-line skip).
 *
 * A record is just an untyped JSON object — adapters preserve the full raw
 * record verbatim (ADR-0004 no-drop) and read only the fields they model.
 */
export type JsonlRecord = Record<string, unknown>;

/** Expand a leading `~` to the user's home directory. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Recursively discover transcript files under a root. Sources shard by
 * project/date directories, so a flat read misses everything — we walk the tree
 * for `*.jsonl`. An optional `accept` predicate narrows to a source's naming
 * convention (e.g. Codex `rollout-*.jsonl`). A missing root is treated as "no
 * transcripts yet", not an error.
 */
export async function discoverTranscripts(root: string, accept?: (name: string) => boolean): Promise<string[]> {
  const base = expandHome(root);
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let handle;
    try {
      handle = await opendir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for await (const entry of handle) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && (!accept || accept(entry.name))) found.push(full);
    }
  }

  await walk(base);
  found.sort();
  return found;
}

/**
 * Stat a path, tolerating transient ENOENT. Sources momentarily drop the path
 * during atomic write-rename, so a naive existence check can race and miss
 * appends (a real gotcha caught during the freshness spike). Returns null only
 * when the path is durably gone.
 */
export async function statWithRetry(path: string): Promise<Stats | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await delay(20);
        continue;
      }
      throw error;
    }
  }
  return null;
}

export interface ReadResult {
  /** Records parsed from complete lines since the cursor offset. */
  records: JsonlRecord[];
  /** Offset to persist: advances only past complete lines (partial trailing line is held). */
  newByteOffset: number;
  /** Bytes of complete lines consumed this read (0 when only a partial line was available). */
  bytesRead: number;
  /** Inode / stable file id observed this read. */
  fileId: string | null;
  /** True when the file shrank below the cursor (truncation / rotation) and we re-anchored at 0. */
  truncated: boolean;
}

/**
 * Read new complete records from a transcript, starting at the cursor offset.
 *
 * Robustness guarantees (issue #5, reused for all sources):
 *   - **Partial trailing line:** only consumes up to the last newline; an
 *     incomplete final record is left for the next read (offset not advanced
 *     past it), so a mid-write append is never parsed half-written.
 *   - **Truncation / rotation:** if the file shrank below the cursor or its
 *     inode changed, re-anchor at 0 rather than reading garbage.
 *   - **Corrupt complete line:** skipped, but still consumed (offset advances),
 *     so one bad line never wedges the tail.
 */
export async function readNewRecords(path: string, cursor: TranscriptCursor): Promise<ReadResult> {
  const info = await statWithRetry(path);
  if (!info) {
    return { records: [], newByteOffset: cursor.byteOffset, bytesRead: 0, fileId: cursor.fileId, truncated: false };
  }

  const fileId = String(info.ino);
  const size = info.size;

  let start = cursor.byteOffset;
  let truncated = false;
  const sameFile = cursor.fileId === null || cursor.fileId === fileId;
  if (!sameFile) {
    // Inode changed: the path was reused for a different file — read it fresh.
    start = 0;
  } else if (cursor.byteOffset > size) {
    // In-place shrink below our offset (truncation / rewrite of the same inode):
    // re-anchor at 0 and re-read. This deliberately re-emits already-committed
    // records (at-least-once) rather than using lastUuid to skip ahead — a skip
    // could silently drop rewritten content, violating the no-drop guarantee.
    // Exactly-once dedup is a downstream concern (keyed on source+sessionId+uuid).
    start = 0;
    truncated = true;
  }

  if (size <= start) {
    return { records: [], newByteOffset: start, bytesRead: 0, fileId, truncated };
  }

  const length = size - start;
  const buffer = Buffer.allocUnsafe(length);
  const handle = await open(path, 'r');
  let received: number;
  try {
    ({ bytesRead: received } = await handle.read(buffer, 0, length, start));
  } finally {
    await handle.close();
  }

  // Only the bytes actually read are valid. `length` came from an earlier
  // stat(); a stat-then-shrink/rotation race can return fewer bytes, leaving
  // the allocUnsafe tail as uninitialized heap memory — never scan past what
  // read() actually returned.
  const data = buffer.subarray(0, received);

  // Newline (0x0A) is single-byte in UTF-8 and never part of a multibyte
  // sequence, so cutting at the last newline is a safe decode boundary.
  const lastNewline = data.lastIndexOf(0x0a);
  if (lastNewline < 0) {
    // No complete line yet — hold everything for the next read.
    return { records: [], newByteOffset: start, bytesRead: 0, fileId, truncated };
  }

  const completeText = data.subarray(0, lastNewline + 1).toString('utf8');
  const records: JsonlRecord[] = [];
  for (const line of completeText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') records.push(parsed as JsonlRecord);
    } catch {
      // Corrupt but complete line: skip it; offset still advances past it below.
    }
  }

  return { records, newByteOffset: start + lastNewline + 1, bytesRead: lastNewline + 1, fileId, truncated };
}
