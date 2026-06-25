import { useFlueClient, useFlueWorkflow } from '@flue/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { recordedLoopwatchEvents, type LoopwatchEvent } from '../loopwatch-events';
import { LoopwatchRunsResponseSchema, type LoopwatchRunPointer } from '../schemas/loopwatch';
import { loopwatchRunsEndpoint } from './endpoints';
import { keepIndexedBatches, replayRunIds, type RunBatches } from './run-index';

export type RunBridgeState = {
  runCount: number;
  eventCount: number;
  status: 'checking' | 'connected' | 'empty' | 'offline';
  detail: string;
};

export type LoopwatchLiveReplay = {
  events: LoopwatchEvent[];
  bridgeState: RunBridgeState;
  bridges: ReactNode;
};

export function useLoopwatchLiveReplay(flueBaseUrl: string): LoopwatchLiveReplay {
  const runsQuery = useQuery<LoopwatchRunPointer[], Error>({
    queryKey: ['loopwatch-run-index', flueBaseUrl],
    queryFn: ({ signal }) => fetchLoopwatchRuns(flueBaseUrl, signal),
    refetchInterval: 1000,
    staleTime: 500,
  });
  const [batches, setBatches] = useState<RunBatches>({});

  const recordRunEvents = useCallback((runId: string, events: LoopwatchEvent[]) => {
    setBatches((current) => {
      const previous = current[runId] ?? [];
      if (previous.length === events.length && previous.at(-1)?.timestamp === events.at(-1)?.timestamp) return current;
      return { ...current, [runId]: events };
    });
  }, []);

  const runIds = useMemo(() => replayRunIds(runsQuery.data), [runsQuery.data]);

  useEffect(() => {
    if (runsQuery.isSuccess) setBatches((current) => keepIndexedBatches(current, runIds.indexedRunIds));
  }, [runIds.indexedRunIds, runsQuery.isSuccess]);

  const events = useMemo(() => Object.values(batches).flat(), [batches]);

  const bridges = <LoopwatchReplayBridges activeRunIds={runIds.activeRunIds} completedRunIds={runIds.completedRunIds} recordRunEvents={recordRunEvents} />;

  return {
    events,
    bridgeState: runBridgeState(runsQuery, runIds.indexedRunIds.length, events.length, runIds.activeRunIds.length),
    bridges,
  };
}

function LoopwatchReplayBridges({
  activeRunIds,
  completedRunIds,
  recordRunEvents,
}: {
  activeRunIds: string[];
  completedRunIds: string[];
  recordRunEvents: (runId: string, events: LoopwatchEvent[]) => void;
}) {
  return (
    <>
      {completedRunIds.map((runId) => (
        <CompletedRunReplay key={runId} runId={runId} onEvents={recordRunEvents} />
      ))}
      {activeRunIds.map((runId) => (
        <WorkflowRunBridge key={runId} runId={runId} onEvents={recordRunEvents} />
      ))}
    </>
  );
}

function CompletedRunReplay({ runId, onEvents }: { runId: string; onEvents: (runId: string, events: LoopwatchEvent[]) => void }) {
  const client = useFlueClient();
  const replay = useQuery({
    queryKey: ['loopwatch-run-replay', runId],
    queryFn: () => client.runs.events(runId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (replay.data) onEvents(runId, recordedLoopwatchEvents(replay.data));
  }, [onEvents, replay.data, runId]);

  return null;
}

function WorkflowRunBridge({ runId, onEvents }: { runId: string; onEvents: (runId: string, events: LoopwatchEvent[]) => void }) {
  const workflow = useFlueWorkflow({ runId });

  useEffect(() => {
    if (!workflow.events) return;
    onEvents(runId, recordedLoopwatchEvents(workflow.events));
  }, [onEvents, runId, workflow.events]);

  return null;
}

function runBridgeState(runsQuery: UseQueryResult<LoopwatchRunPointer[], Error>, runCount: number, eventCount: number, activeRunCount: number): RunBridgeState {
  if (runsQuery.isPending) return { runCount, eventCount, status: 'checking', detail: 'discovering record-events runs' };
  if (runsQuery.isError) return { runCount, eventCount, status: 'offline', detail: runsQuery.error.message };
  if (runCount === 0) return { runCount, eventCount, status: 'empty', detail: 'no adapter runs yet' };
  return { runCount, eventCount, status: 'connected', detail: `${eventCount} events · ${runCount} runs · ${activeRunCount} live` };
}

async function fetchLoopwatchRuns(baseUrl: string, signal?: AbortSignal): Promise<LoopwatchRunPointer[]> {
  const response = await fetch(loopwatchRunsEndpoint(baseUrl), { signal });
  if (!response.ok) throw new Error(`Loopwatch run index failed with HTTP ${response.status}`);
  const parsed = LoopwatchRunsResponseSchema.parse(await response.json());
  return parsed.runs;
}
