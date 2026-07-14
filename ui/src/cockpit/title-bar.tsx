import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { EngineHealthSchema, type EngineHealth } from '../schemas/loopwatch';
import { healthEndpoint } from './endpoints';
import { withEngineAuth, type EngineRuntime } from '../engine-runtime';
import type { RunBridgeState } from './live-replay';
import { BrandGlyph, SeverityBadge, statusLightClass } from './visual';

type EngineState =
  | { kind: 'checking'; label: string; detail: string }
  | { kind: 'connected'; label: string; detail: string }
  | { kind: 'offline'; label: string; detail: string };

export function TitleBar({ engineRuntime, bridgeState }: { engineRuntime: EngineRuntime; bridgeState: RunBridgeState }) {
  return (
    <header className="flex items-center gap-3 border-b border-watch-line bg-gradient-to-b from-watch-bg-top to-watch-bg-bottom px-3.5">
      <div className="flex items-center gap-2 text-watch-accent">
        <BrandGlyph className="h-4 w-4" />
        <span className="text-[13px] font-semibold text-watch-ink">Loopwatch</span>
      </div>
      <div className="h-4 w-px bg-watch-line-2" />
      <div className="truncate text-[12px] text-watch-ink-3">
        local-first <b className="font-medium text-watch-ink-2">/</b>{' '}
        <span className="font-medium text-watch-ink">Cockpit</span>
      </div>
      <SeveritySpectrum />
      <div className="flex-1" />
      <LiveStreamConnection state={bridgeState} />
      <EngineConnection engineRuntime={engineRuntime} />
    </header>
  );
}

function SeveritySpectrum() {
  return (
    <div aria-label="Severity spectrum" className="hidden items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[.08em] text-watch-ink-3 min-[1120px]:flex">
      <span>severity</span>
      <SeverityBadge severity="calm" />
      <SeverityBadge severity="watch" />
      <SeverityBadge severity="intervention" />
    </div>
  );
}

function EngineConnection({ engineRuntime }: { engineRuntime: EngineRuntime }) {
  const health = useQuery<EngineHealth, Error>({
    queryKey: ['engine-health', engineRuntime.flueBaseUrl],
    queryFn: ({ signal }) => fetchEngineHealth(engineRuntime, signal),
    refetchInterval: 5000,
    staleTime: 2500,
  });
  const state = engineState(health, engineRuntime.flueBaseUrl);
  const colorClass = statusLightClass[state.kind];

  return (
    <div
      className="flex max-w-[340px] items-center gap-2 rounded-[7px] border border-watch-line bg-watch-glass px-2.5 py-1 font-mono text-[11px] text-watch-ink-2"
      title={state.detail}
    >
      <span className={`h-2 w-2 rounded-full ${colorClass}`} aria-hidden="true" />
      <span className="font-medium text-watch-ink">{state.label}</span>
      <span className="truncate text-watch-ink-3">{state.detail}</span>
    </div>
  );
}

function LiveStreamConnection({ state }: { state: RunBridgeState }) {
  return (
    <div
      className="flex max-w-[320px] items-center gap-2 rounded-[7px] border border-watch-line bg-watch-glass px-2.5 py-1 font-mono text-[11px] text-watch-ink-2"
      title={state.detail}
    >
      <span className={`h-2 w-2 rounded-full ${statusLightClass[state.status]}`} aria-hidden="true" />
      <span className="font-medium text-watch-ink">live replay</span>
      <span className="truncate text-watch-ink-3">{state.detail}</span>
    </div>
  );
}

function engineState(health: UseQueryResult<EngineHealth, Error>, flueBaseUrl: string): EngineState {
  if (health.isPending) {
    return { kind: 'checking', label: 'checking', detail: healthEndpoint(flueBaseUrl) };
  }
  if (health.isSuccess) {
    return {
      kind: 'connected',
      label: 'engine connected',
      detail: `${health.data.service} (${health.data.target})`,
    };
  }
  return {
    kind: 'offline',
    label: 'engine offline',
    detail: health.error instanceof Error ? health.error.message : 'Unknown health probe error',
  };
}

async function fetchEngineHealth(engineRuntime: EngineRuntime, signal?: AbortSignal): Promise<EngineHealth> {
  const response = await fetch(healthEndpoint(engineRuntime.flueBaseUrl), withEngineAuth({ signal }, engineRuntime.bearerToken));
  if (!response.ok) throw new Error(`Health probe failed with HTTP ${response.status}`);
  return EngineHealthSchema.parse(await response.json());
}
