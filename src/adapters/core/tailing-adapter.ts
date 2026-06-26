import type { LoopwatchEventInput } from '../../events.js';
import type { Capability } from './capabilities.js';
import {
  cursorDirFor,
  loadCursor,
  newCursor,
  saveCursor,
  type TranscriptCursor,
} from './cursor.js';
import {
  DEFAULT_LIVENESS,
  LivenessTracker,
  type LivenessThresholds,
  type LivenessTransition,
} from './liveness.js';
import { discoverTranscripts, readNewRecords, statWithRetry, type JsonlRecord } from './transcript.js';

/** Sink that commits a batch of normalized events. Throws on failure (cursor won't advance). */
export type IngestFn = (events: LoopwatchEventInput[]) => Promise<void>;

/** Map one raw transcript record to one normalized event (ADR-0004, one-to-one, no-drop). */
export type MapRecord = (record: JsonlRecord, context: { fileSessionId: string }) => LoopwatchEventInput;

/**
 * Optional async post-map enrichment for a whole batch, run before ingest.
 * Used by sources that must resolve out-of-band context (e.g. inferring git
 * branch for Pi, whose transcript records no branch). Keeps {@link MapRecord}
 * synchronous and isolates I/O to one place.
 */
export type EnrichBatch = (events: LoopwatchEventInput[]) => Promise<LoopwatchEventInput[]>;

export interface TailingAdapterConfig {
  /** Source name emitted on every event (ADR-0003 identity, part 1). */
  source: string;
  /** Sink that commits each mapped batch. */
  ingest: IngestFn;
  /** Transcript root (a `~`-prefixed path is expanded). */
  root: string;
  /** Map a raw record to a normalized event. */
  mapRecord: MapRecord;
  /** Derive a transcript's session id from its filename (fallback when records omit it). */
  sessionIdFromPath: (path: string) => string;
  /** Parser version persisted in each cursor; bump when the mapping changes. */
  parserVersion: number;
  /** Where cursors are persisted. Default `data/cursors/<source>`. */
  cursorDir?: string;
  /** Narrow discovery to a source's filename convention (e.g. Codex `rollout-*`). */
  accept?: (name: string) => boolean;
  /** Optional batch enrichment run before ingest (e.g. git-branch inference). */
  enrich?: EnrichBatch;
  /** Declared capabilities for this source (honest badges; no fake parity). */
  capabilities?: Capability[];
  thresholds?: LivenessThresholds;
  /**
   * Where to start a transcript with no cursor. `'end'` (default) tails only
   * new activity — it does not replay the historical transcripts on disk.
   * `'start'` reads from the beginning (used by tests against fixtures).
   */
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

/** The last usable record id in a batch (`uuid` or `id`), for cursor bookkeeping. */
function lastRecordId(records: JsonlRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    const id = record?.uuid ?? record?.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/**
 * The shared Source-Adapter tail engine (issue #11), extracted from the Claude
 * adapter (issue #5) so Codex and Pi reuse the same seam.
 *
 * `scanOnce()` performs one tail pass over every discovered transcript: read
 * new complete records past the cursor, map them to normalized events, optionally
 * enrich the batch, ingest it, then advance and persist the cursor — so a record
 * is only counted once and a restart resumes without re-emitting. `runForever()`
 * polls `scanOnce()` plus liveness on an interval; new appends to an active
 * transcript surface as new events without a restart.
 *
 * Each source supplies only its differences via {@link TailingAdapterConfig}:
 * the record→event mapping, the filename→session-id rule, its declared
 * capabilities, and (optionally) batch enrichment.
 */
export class TailingAdapter {
  readonly source: string;
  readonly capabilities: Capability[];
  private readonly root: string;
  private readonly cursorDir: string;
  private readonly parserVersion: number;
  private readonly initialAnchor: 'start' | 'end';
  private readonly accept?: (name: string) => boolean;
  private readonly enrich?: EnrichBatch;
  private readonly mapRecord: MapRecord;
  private readonly sessionIdFromPath: (path: string) => string;
  private readonly log: (message: string, data?: unknown) => void;
  private readonly cursors = new Map<string, TranscriptCursor>();
  private readonly liveness: LivenessTracker;
  private running = false;

  constructor(private readonly config: TailingAdapterConfig) {
    this.source = config.source;
    this.capabilities = config.capabilities ?? ['transcript', 'tools'];
    this.root = config.root;
    this.cursorDir = config.cursorDir ?? cursorDirFor(config.source);
    this.parserVersion = config.parserVersion;
    this.initialAnchor = config.initialAnchor ?? 'end';
    this.accept = config.accept;
    this.enrich = config.enrich;
    this.mapRecord = config.mapRecord;
    this.sessionIdFromPath = config.sessionIdFromPath;
    this.log = config.log ?? (() => {});
    this.liveness = new LivenessTracker(config.thresholds ?? DEFAULT_LIVENESS);
  }

  get livenessTracker(): LivenessTracker {
    return this.liveness;
  }

  /** Load, or seed-and-persist, the cursor for a transcript. Null = skip this pass. */
  private async cursorFor(path: string): Promise<TranscriptCursor | null> {
    const cached = this.cursors.get(path);
    if (cached) return cached;

    const load = await loadCursor(this.cursorDir, path, this.parserVersion);
    if (load.status === 'loaded') {
      this.cursors.set(path, load.cursor);
      return load.cursor;
    }

    let cursor: TranscriptCursor;
    if (this.initialAnchor === 'end' && load.status === 'missing') {
      // Brand-new transcript, tail-only: seed at the current end. An
      // 'invalidated' cursor must NOT land here — re-seeding to end would skip
      // every record since the old offset; it falls through to a 0-offset
      // re-read below so the new parser re-emits the affected records.
      const info = await statWithRetry(path);
      if (!info) {
        // File absent at first discovery. Skip this pass rather than seed at 0,
        // which would replay the whole file if it reappears. Retry next pass.
        return null;
      }
      cursor = { path, fileId: String(info.ino), byteOffset: info.size, lastUuid: null, parserVersion: this.parserVersion };
    } else {
      // 'start' anchor, or an invalidated cursor: re-read from offset 0.
      cursor = newCursor(path, this.parserVersion);
    }
    await saveCursor(this.cursorDir, cursor);
    this.cursors.set(path, cursor);
    return cursor;
  }

  /** One tail pass over all transcripts. */
  async scanOnce(now: number = Date.now()): Promise<ScanSummary> {
    const files = await discoverTranscripts(this.root, this.accept);
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
        // Isolate per-transcript failures: a single locked / unreadable / failing
        // transcript must not abort the whole pass or starve the transcripts
        // after it in sort order. Its cursor is left unadvanced, so the next
        // pass retries just that file (issue #5 review).
        this.log('transcript scan failed; continuing', { path, error });
      }
    }

    return { scannedFiles: files.length, ingestedEvents, perFile };
  }

  /** Tail one transcript: read new records, ingest, then advance its cursor. */
  private async scanFile(path: string, now: number): Promise<ScanFileResult | null> {
    const cursor = await this.cursorFor(path);
    if (!cursor) return null;
    const read = await readNewRecords(path, cursor);

    if (read.bytesRead === 0) {
      // No complete new records. Persist whatever re-anchor readNewRecords
      // already computed — crucially the new inode AND its newByteOffset (0 on
      // rotation). Keeping the old, larger byteOffset here would make the next
      // pass treat the rotated inode as the same file and read from a stale
      // offset, silently skipping the new file's leading records.
      if (read.fileId !== cursor.fileId || read.newByteOffset !== cursor.byteOffset) {
        const refreshed = { ...cursor, fileId: read.fileId, byteOffset: read.newByteOffset };
        this.cursors.set(path, refreshed);
        await saveCursor(this.cursorDir, refreshed);
      }
      return null;
    }

    const fileSessionId = this.sessionIdFromPath(path);
    let events = read.records.map((record) => this.mapRecord(record, { fileSessionId }));
    if (this.enrich && events.length > 0) events = await this.enrich(events);

    // Ingest first; only advance the cursor after the batch is committed.
    if (events.length > 0) await this.config.ingest(events);

    const updated: TranscriptCursor = {
      path,
      fileId: read.fileId,
      byteOffset: read.newByteOffset,
      lastUuid: lastRecordId(read.records) ?? cursor.lastUuid,
      parserVersion: this.parserVersion,
    };
    this.cursors.set(path, updated);
    await saveCursor(this.cursorDir, updated);

    for (const event of events) {
      this.liveness.observe({ source: event.source, sessionId: event.sessionId }, now);
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

  /** Poll scanOnce + liveness until {@link stop} is called. */
  async runForever({ pollMs = 1000 }: { pollMs?: number } = {}): Promise<void> {
    const { setTimeout: delay } = await import('node:timers/promises');
    this.running = true;
    this.log(`${this.source} adapter watching ${this.root} (poll ${pollMs}ms, anchor ${this.initialAnchor})`);
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
export function httpIngest(serverUrl: string): IngestFn {
  return async (events) => {
    const response = await fetch(`${serverUrl}/workflows/record-events?wait=result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      throw new Error(`record-events ingest failed: ${response.status} ${await response.text()}`);
    }
  };
}
