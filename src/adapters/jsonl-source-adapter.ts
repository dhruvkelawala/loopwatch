import type { LoopwatchEventInput } from '../events.js';
import { setTimeout as delay } from 'node:timers/promises';

import {
  DEFAULT_LIVENESS,
  LivenessTracker,
  type LivenessThresholds,
  type LivenessTransition,
} from './claude/liveness.js';
import {
  loadCursor,
  newCursor,
  saveCursor,
  type TranscriptCursor,
} from './claude/cursor.js';
import { discoverTranscripts, readNewRecords, statWithRetry } from './claude/transcript.js';

/** Sink that commits a batch of normalized events. Throws on failure (cursor won't advance). */
export type IngestFn = (events: LoopwatchEventInput[]) => Promise<void>;

export interface MapRecordOptions {
  fileSessionId?: string;
  path: string;
  inferredContext?: Record<string, unknown>;
}

export type MapRecordFn<TRecord extends Record<string, unknown>> = (
  record: TRecord,
  options: MapRecordOptions,
) => LoopwatchEventInput;

export type RecordIdFn<TRecord extends Record<string, unknown>> = (records: TRecord[]) => string | null;
export type SessionIdFromPathFn = (path: string) => string;
export type InferredContextFn<TRecord extends Record<string, unknown>> = (
  records: TRecord[],
  path: string,
) => Record<string, unknown> | undefined;

export interface JsonlSourceAdapterConfig<TRecord extends Record<string, unknown>> {
  source: string;
  ingest: IngestFn;
  root: string;
  cursorDir: string;
  mapRecord: MapRecordFn<TRecord>;
  recordId: RecordIdFn<TRecord>;
  sessionIdFromPath: SessionIdFromPathFn;
  inferContext?: InferredContextFn<TRecord>;
  thresholds?: LivenessThresholds;
  initialAnchor?: 'start' | 'end';
  log?: (message: string, data?: unknown) => void;
}

export interface ScanFileResult {
  path: string;
  records: number;
  events: number;
  truncated: boolean;
}

export interface ScanSummary {
  scannedFiles: number;
  ingestedEvents: number;
  perFile: ScanFileResult[];
}

/**
 * Generic JSONL Source Adapter.
 *
 * Each Source still owns its mapping and capabilities; this class only supplies
 * the boring tail/cursor/liveness mechanics shared by Level 1 passive JSONL
 * sources. Cursor advancement remains commit-after-ingest, preserving the
 * at-least-once/no-drop guarantees already proven for Claude.
 */
export class JsonlSourceAdapter<TRecord extends Record<string, unknown>> {
  private readonly cursors = new Map<string, TranscriptCursor>();
  private readonly liveness: LivenessTracker;
  private running = false;

  constructor(private readonly config: JsonlSourceAdapterConfig<TRecord>) {
    this.liveness = new LivenessTracker(config.thresholds ?? DEFAULT_LIVENESS);
  }

  get livenessTracker(): LivenessTracker {
    return this.liveness;
  }

  private get initialAnchor(): 'start' | 'end' {
    return this.config.initialAnchor ?? 'end';
  }

  private get log(): (message: string, data?: unknown) => void {
    return this.config.log ?? (() => {});
  }

  /** Load, or seed-and-persist, the cursor for a transcript. Null = skip this pass. */
  private async cursorFor(path: string): Promise<TranscriptCursor | null> {
    const cached = this.cursors.get(path);
    if (cached) return cached;

    const load = await loadCursor(this.config.cursorDir, path);
    if (load.status === 'loaded') {
      this.cursors.set(path, load.cursor);
      return load.cursor;
    }

    let cursor: TranscriptCursor;
    if (this.initialAnchor === 'end' && load.status === 'missing') {
      const info = await statWithRetry(path);
      if (!info) return null;
      cursor = { path, fileId: String(info.ino), byteOffset: info.size, lastUuid: null, parserVersion: 1 };
    } else {
      cursor = newCursor(path);
    }
    await saveCursor(this.config.cursorDir, cursor);
    this.cursors.set(path, cursor);
    return cursor;
  }

  /** One tail pass over all source transcripts. */
  async scanOnce(now: number = Date.now()): Promise<ScanSummary> {
    const files = await discoverTranscripts(this.config.root);
    const perFile: ScanFileResult[] = [];
    let ingestedEvents = 0;

    for (const path of files) {
      try {
        const result = await this.scanFile(path, now);
        if (result) {
          perFile.push(result);
          ingestedEvents += result.events;
        }
      } catch (error) {
        this.log(`${this.config.source} transcript scan failed; continuing`, { path, error });
      }
    }

    return { scannedFiles: files.length, ingestedEvents, perFile };
  }

  private async scanFile(path: string, now: number): Promise<ScanFileResult | null> {
    const cursor = await this.cursorFor(path);
    if (!cursor) return null;
    const read = await readNewRecords(path, cursor);

    if (read.bytesRead === 0) {
      if (read.fileId !== cursor.fileId || read.newByteOffset !== cursor.byteOffset) {
        const refreshed = { ...cursor, fileId: read.fileId, byteOffset: read.newByteOffset };
        this.cursors.set(path, refreshed);
        await saveCursor(this.config.cursorDir, refreshed);
      }
      return null;
    }

    const fileSessionId = this.config.sessionIdFromPath(path);
    const records = read.records as TRecord[];
    const inferredContext = this.config.inferContext?.(records, path);
    const events = records.map((record) =>
      this.config.mapRecord(record, { fileSessionId, path, inferredContext }),
    );

    if (events.length > 0) await this.config.ingest(events);

    const updated: TranscriptCursor = {
      path,
      fileId: read.fileId,
      byteOffset: read.newByteOffset,
      lastUuid: this.config.recordId(records) ?? cursor.lastUuid,
      parserVersion: 1,
    };
    this.cursors.set(path, updated);
    await saveCursor(this.config.cursorDir, updated);

    for (const event of events) {
      this.liveness.observe({ source: event.source as string, sessionId: event.sessionId as string }, now);
    }

    return { path, records: read.records.length, events: events.length, truncated: read.truncated };
  }

  /** Recompute liveness and log any transitions. */
  pollLiveness(now: number = Date.now()): LivenessTransition[] {
    const transitions = this.liveness.poll(now);
    for (const transition of transitions) {
      this.log(`liveness ${transition.from} → ${transition.to}`, transition.identity);
    }
    return transitions;
  }

  async runForever({ pollMs = 1000 }: { pollMs?: number } = {}): Promise<void> {
    this.running = true;
    this.log(`${this.config.source} adapter watching ${this.config.root} (poll ${pollMs}ms, anchor ${this.initialAnchor})`);
    while (this.running) {
      try {
        const summary = await this.scanOnce();
        if (summary.ingestedEvents > 0) {
          this.log(`ingested ${summary.ingestedEvents} event(s) from ${summary.perFile.length} transcript(s)`);
        }
        this.pollLiveness();
      } catch (error) {
        this.log('scan error', error);
      }
      await delay(pollMs);
    }
  }

  stop(): void {
    this.running = false;
  }
}

/** Default ingest: POST a batch to the running Flue server's record-events workflow. */
export function httpIngest(serverUrl: string, options: { token?: string } = {}): IngestFn {
  return async (events) => {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (options.token) headers.set('authorization', `Bearer ${options.token}`);

    const response = await fetch(`${serverUrl}/workflows/record-events?wait=result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      throw new Error(`record-events ingest failed: ${response.status} ${await response.text()}`);
    }
  };
}
