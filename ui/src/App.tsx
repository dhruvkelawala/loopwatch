import { useState } from 'react';
import { EvidenceInspector } from './cockpit/evidence-inspector';
import { interventionCardForSession, timelineItemElementId, type InterventionCardModel } from './cockpit/intervention-card';
import { useLoopwatchLiveReplay } from './cockpit/live-replay';
import { SessionRail } from './cockpit/session-rail';
import { useCockpitSessionModel } from './cockpit/session-model';
import { Timeline } from './cockpit/timeline';
import { TitleBar } from './cockpit/title-bar';
import type { EngineRuntime } from './engine-runtime';

export function App({ engineRuntime }: { engineRuntime: EngineRuntime }) {
  const [dismissedInterventionIds, setDismissedInterventionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedInterventionId, setFocusedInterventionId] = useState<string | undefined>();
  const live = useLoopwatchLiveReplay(engineRuntime);
  const sessionModel = useCockpitSessionModel(live.events, live.convergenceSessions);
  const interventionCard = interventionCardForSession(sessionModel.selected, dismissedInterventionIds);
  const focusedTimelineItemId = interventionCard && focusedInterventionId === interventionCard.id ? interventionCard.timelineItemId : undefined;

  const inspectIntervention = (card: InterventionCardModel) => {
    setFocusedInterventionId(card.id);
    window.requestAnimationFrame(() => document.getElementById(timelineItemElementId(card.timelineItemId))?.scrollIntoView({ block: 'center' }));
  };

  const dismissIntervention = (id: string) => {
    setDismissedInterventionIds((current) => new Set(current).add(id));
    if (focusedInterventionId === id) setFocusedInterventionId(undefined);
  };

  return (
    <>
      {live.bridges}

      <main className="grid h-screen grid-rows-[42px_1fr_26px] overflow-hidden bg-watch-shell font-sans text-[12.5px] tracking-[-0.005em] text-watch-ink antialiased">
        <TitleBar engineRuntime={engineRuntime} bridgeState={live.bridgeState} />

        <section className="grid min-h-0 grid-cols-[260px_minmax(520px,1fr)_320px] overflow-hidden max-[980px]:grid-cols-[236px_minmax(480px,1fr)]">
          <SessionRail
            groupedSessions={sessionModel.groupedSessions}
            selectedId={sessionModel.selected?.id ?? ''}
            onSelect={sessionModel.selectSession}
          />
          <Timeline
            session={sessionModel.selected}
            interventionCard={interventionCard}
            focusedTimelineItemId={focusedTimelineItemId}
            onInspectIntervention={inspectIntervention}
            onDismissIntervention={dismissIntervention}
          />
          <EvidenceInspector
            session={sessionModel.selected}
            flueBaseUrl={engineRuntime.flueBaseUrl}
            bridgeState={live.bridgeState}
            convergenceState={live.convergenceState}
            focusedEvidenceKey={focusedInterventionId}
          />
        </section>

        <footer className="flex items-center gap-4 border-t border-watch-line bg-watch-bg-deep px-4 font-mono text-[10px] text-watch-ink-3">
          <span>Loopwatch Cockpit · Watchtower</span>
          <span className="h-1 w-1 rounded-full bg-watch-line-2" />
          <span>{live.bridgeState.runCount} Flue batch runs replayed</span>
          <span className="h-1 w-1 rounded-full bg-watch-line-2" />
          <span>{live.bridgeState.eventCount} normalized events</span>
          <span className="ml-auto text-watch-ink-2">LLM spend cheap {live.convergenceState.spend.cheapCalls} · strong {live.convergenceState.spend.strongCalls} · ${live.convergenceState.spend.estimatedCostUsd.toFixed(6)} · {live.convergenceState.detail}</span>
        </footer>
      </main>
    </>
  );
}
