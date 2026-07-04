import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IngestFn } from '../src/adapters/jsonl-source-adapter.js';
import { ClaudeAdapter } from '../src/adapters/claude/adapter.js';
import { CodexAdapter } from '../src/adapters/codex/adapter.js';
import { PiAdapter } from '../src/adapters/pi/adapter.js';

const requested = process.env.LOOPWATCH_SOURCE_SMOKE === '1';

if (!requested) {
  console.log('SKIP source smoke: set LOOPWATCH_SOURCE_SMOKE=1, LOOPWATCH_SOURCE, and LOOPWATCH_SOURCE_SMOKE_ROOT to scan local transcripts.');
  process.exit(0);
}

const source = process.env.LOOPWATCH_SOURCE ?? 'claude';
if (!['claude', 'codex', 'pi'].includes(source)) {
  console.error(`Unsupported source smoke provider ${JSON.stringify(source)}. Supported providers: claude, codex, pi.`);
  process.exit(1);
}

const root = process.env.LOOPWATCH_SOURCE_SMOKE_ROOT;
if (!root) {
  console.error('LOOPWATCH_SOURCE_SMOKE=1 requires LOOPWATCH_SOURCE_SMOKE_ROOT; refusing to scan implicit real transcript locations.');
  process.exit(1);
}

const cursorDir = await mkdtemp(join(tmpdir(), 'loopwatch-source-smoke-cursors-'));
const collected: unknown[] = [];
const ingest: IngestFn = async (events) => {
  collected.push(...events);
};

try {
  const adapter =
    source === 'claude'
      ? new ClaudeAdapter({
          root,
          cursorDir,
          initialAnchor: 'start',
          ingest,
          log: (message, data) => console.warn(`[source-smoke:${source}] ${message}`, data ?? ''),
        })
      : source === 'codex'
        ? new CodexAdapter({
            root,
            cursorDir,
            initialAnchor: 'start',
            ingest,
            log: (message, data) => console.warn(`[source-smoke:${source}] ${message}`, data ?? ''),
          })
        : new PiAdapter({
            root,
            cursorDir,
            initialAnchor: 'start',
            ingest,
            log: (message, data) => console.warn(`[source-smoke:${source}] ${message}`, data ?? ''),
          });

  const summary = await adapter.scanOnce(Date.parse('2026-07-04T00:00:00.000Z'));
  assert.ok(summary.scannedFiles > 0, `no ${source} transcript files discovered under ${root}`);
  assert.ok(collected.length > 0, `no normalized events emitted from ${root}`);
  assert.equal(summary.ingestedEvents, collected.length);
  console.log(`Source smoke passed: ${source}; ${summary.scannedFiles} transcript(s), ${summary.ingestedEvents} normalized event(s).`);
} finally {
  await rm(cursorDir, { recursive: true, force: true });
}
