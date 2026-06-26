import type { LoopwatchEvent, LoopwatchRunPointer } from '../schemas/loopwatch.js';

export type RunBatches = Record<string, LoopwatchEvent[]>;

export type ReplayRunIds = {
  indexedRunIds: string[];
  activeRunIds: string[];
  completedRunIds: string[];
};

export function replayRunIds(runs: LoopwatchRunPointer[] | undefined): ReplayRunIds {
  const indexedRunIds: string[] = [];
  const activeRunIds: string[] = [];
  const completedRunIds: string[] = [];

  for (const run of runs ?? []) {
    indexedRunIds.push(run.runId);
    if (run.status === 'active') activeRunIds.push(run.runId);
    else completedRunIds.push(run.runId);
  }

  return { indexedRunIds, activeRunIds, completedRunIds };
}

export function keepIndexedBatches(current: RunBatches, indexedRunIds: string[]): RunBatches {
  const indexed = new Set(indexedRunIds);
  let changed = false;
  const next: RunBatches = {};
  for (const [runId, events] of Object.entries(current)) {
    if (indexed.has(runId)) next[runId] = events;
    else changed = true;
  }
  return changed ? next : current;
}
