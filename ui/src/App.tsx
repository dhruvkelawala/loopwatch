import { EvidenceInspector } from './cockpit/evidence-inspector';
import { useLoopwatchLiveReplay } from './cockpit/live-replay';
import { SessionRail } from './cockpit/session-rail';
import { useCockpitSessionModel } from './cockpit/session-model';
import { Timeline } from './cockpit/timeline';
import { TitleBar } from './cockpit/title-bar';

export function App({ flueBaseUrl }: { flueBaseUrl: string }) {
  const live = useLoopwatchLiveReplay(flueBaseUrl);
  const sessionModel = useCockpitSessionModel(live.events);

  return (
    <>
      {live.bridges}

      <main className="grid h-screen grid-rows-[42px_1fr_26px] overflow-hidden bg-watch-shell font-sans text-[12.5px] tracking-[-0.005em] text-watch-ink antialiased">
        <TitleBar flueBaseUrl={flueBaseUrl} bridgeState={live.bridgeState} />

        <section className="grid min-h-0 grid-cols-[260px_minmax(520px,1fr)_320px] overflow-hidden max-[980px]:grid-cols-[236px_minmax(480px,1fr)]">
          <SessionRail
            groupedSessions={sessionModel.groupedSessions}
            selectedId={sessionModel.selected?.id ?? ''}
            onSelect={sessionModel.selectSession}
          />
          <Timeline session={sessionModel.selected} />
          <EvidenceInspector session={sessionModel.selected} flueBaseUrl={flueBaseUrl} bridgeState={live.bridgeState} />
        </section>

        <footer className="flex items-center gap-4 border-t border-watch-line bg-watch-bg-deep px-4 font-mono text-[10px] text-watch-ink-3">
          <span>Loopwatch Cockpit · Watchtower</span>
          <span className="h-1 w-1 rounded-full bg-watch-line-2" />
          <span>{live.bridgeState.runCount} Flue batch runs replayed</span>
          <span className="h-1 w-1 rounded-full bg-watch-line-2" />
          <span>{live.bridgeState.eventCount} normalized events</span>
          <span className="ml-auto text-watch-ink-2">convergence lane intentionally empty until Slice 6</span>
        </footer>
      </main>
    </>
  );
}
