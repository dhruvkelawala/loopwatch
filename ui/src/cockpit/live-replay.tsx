import { useFlueClient, useFlueWorkflow } from '@flue/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { recordedLoopwatchEvents, type LoopwatchEvent } from '../loopwatch-events';
import { LoopwatchConvergenceResponseSchema, LoopwatchRunsResponseSchema, type ConvergenceSpend, type LoopwatchRunPointer, type SessionConvergence } from '../schemas/loopwatch';
import { loopwatchConvergenceEndpoint, loopwatchRunsEndpoint } from './endpoints';
import { keepIndexedBatches, replayRunIds, type RunBatches } from './run-index';
import { withEngineAuth, type EngineRuntime } from '../engine-runtime';

export type RunBridgeState = {
  runCount: number;
  eventCount: number;
  status: 'checking' | 'connected' | 'empty' | 'offline';
  detail: string;
};

export type ConvergenceBridgeState = {
  sessionCount: number;
  status: 'checking' | 'connected' | 'empty' | 'offline';
  detail: string;
  spend: ConvergenceSpend;
};

export type LoopwatchLiveReplay = {
  events: LoopwatchEvent[];
  convergenceSessions: SessionConvergence[];
  convergenceState: ConvergenceBridgeState;
  bridgeState: RunBridgeState;
  bridges: ReactNode;
};

export type PivotMode = 'calm' | 'loud';

export function useLoopwatchLiveReplay(engineRuntime: EngineRuntime, pivotMode: PivotMode = 'calm'): LoopwatchLiveReplay {
  const runsQuery = useQuery<LoopwatchRunPointer[], Error>({
    queryKey: ['loopwatch-run-index', engineRuntime.flueBaseUrl],
    queryFn: ({ signal }) => fetchLoopwatchRuns(engineRuntime, signal),
    refetchInterval: 1000,
    staleTime: 500,
  });
  const convergenceQuery = useQuery({
    queryKey: ['loopwatch-convergence', engineRuntime.flueBaseUrl, pivotMode],
    queryFn: ({ signal }) => fetchConvergence(engineRuntime, pivotMode, signal),
    refetchInterval: (query) => query.state.data?.nextPollMs ?? 2000,
    staleTime: 1000,
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
    convergenceSessions: convergenceQuery.data?.sessions ?? [],
    convergenceState: convergenceBridgeState(convergenceQuery),
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

const emptySpend: ConvergenceSpend = { cheapCalls: 0, strongCalls: 0, totalCalls: 0, estimatedTokens: 0, estimatedCostUsd: 0 };

function convergenceBridgeState(convergenceQuery: UseQueryResult<{ sessions: SessionConvergence[]; spend: ConvergenceSpend; nextPollMs: number }, Error>): ConvergenceBridgeState {
  if (convergenceQuery.isPending) return { sessionCount: 0, status: 'checking', detail: 'checking watcher state', spend: emptySpend };
  if (convergenceQuery.isError) return { sessionCount: 0, status: 'offline', detail: convergenceQuery.error.message, spend: emptySpend };
  if (convergenceQuery.data.sessions.length === 0) return { sessionCount: 0, status: 'empty', detail: 'no watched sessions yet', spend: convergenceQuery.data.spend };
  return {
    sessionCount: convergenceQuery.data.sessions.length,
    status: 'connected',
    detail: `${convergenceQuery.data.sessions.length} watched · ${convergenceQuery.data.spend.totalCalls} judge calls · $${convergenceQuery.data.spend.estimatedCostUsd.toFixed(6)}`,
    spend: convergenceQuery.data.spend,
  };
}

function runBridgeState(runsQuery: UseQueryResult<LoopwatchRunPointer[], Error>, runCount: number, eventCount: number, activeRunCount: number): RunBridgeState {
  if (runsQuery.isPending) return { runCount, eventCount, status: 'checking', detail: 'discovering record-events runs' };
  if (runsQuery.isError) return { runCount, eventCount, status: 'offline', detail: runsQuery.error.message };
  if (runCount === 0) return { runCount, eventCount, status: 'empty', detail: 'no adapter runs yet' };
  return { runCount, eventCount, status: 'connected', detail: `${eventCount} events · ${runCount} runs · ${activeRunCount} live` };
}

async function fetchLoopwatchRuns(engineRuntime: EngineRuntime, signal?: AbortSignal): Promise<LoopwatchRunPointer[]> {
  const response = await fetch(loopwatchRunsEndpoint(engineRuntime.flueBaseUrl), withEngineAuth({ signal }, engineRuntime.bearerToken));
  if (!response.ok) throw new Error(`Loopwatch run index failed with HTTP ${response.status}`);
  const parsed = LoopwatchRunsResponseSchema.parse(await response.json());
  return parsed.runs;
}

async function fetchConvergence(engineRuntime: EngineRuntime, pivotMode: PivotMode, signal?: AbortSignal): Promise<{ sessions: SessionConvergence[]; spend: ConvergenceSpend; nextPollMs: number }> {
  const response = await fetch(loopwatchConvergenceEndpoint(engineRuntime.flueBaseUrl, pivotMode), withEngineAuth({ signal }, engineRuntime.bearerToken));
  if (!response.ok) throw new Error(`Loopwatch convergence failed with HTTP ${response.status}`);
  const parsed = LoopwatchConvergenceResponseSchema.parse(await response.json());
  return { sessions: parsed.sessions, spend: parsed.spend, nextPollMs: parsed.nextPollMs };
}
