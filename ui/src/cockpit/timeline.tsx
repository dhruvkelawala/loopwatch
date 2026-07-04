import type { Severity, SessionView, TimelineItem, TimelineLane } from '../loopwatch-events';
import { InterventionCard, timelineItemElementId, type InterventionCardModel } from './intervention-card';
import { chipToneClass, ConvergenceDial, formatClock, LivenessPill, SeverityBadge, valueToneClass } from './visual';

export function Timeline({
  session,
  interventionCard,
  focusedTimelineItemId,
  onInspectIntervention,
  onDismissIntervention,
  pivotMode,
  onPivotModeChange,
}: {
  session: SessionView | undefined;
  interventionCard?: InterventionCardModel;
  focusedTimelineItemId?: string;
  onInspectIntervention: (card: InterventionCardModel) => void;
  onDismissIntervention: (id: string) => void;
  pivotMode: 'calm' | 'loud';
  onPivotModeChange: (mode: 'calm' | 'loud') => void;
}) {
  if (!session) return <EmptyTimeline />;

  return (
    <section className="min-h-0 overflow-auto bg-transparent">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-watch-line bg-watch-title-fade px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-[15px] font-semibold text-white">{session.title}</h1>
            <span className="text-[12.5px] text-watch-ink-2">{session.source}</span>
            <span className="rounded-[5px] border border-watch-line bg-watch-glass-strong px-2 py-0.5 font-mono text-[11px] text-watch-ink-2">
              {session.branch}
            </span>
            <SeverityBadge severity={session.severity} />
            <LivenessPill liveness={session.liveness} />
            <PivotModeToggle mode={pivotMode} onChange={onPivotModeChange} />
          </div>
          <p className="mt-3 max-w-[760px] text-[12.5px] leading-[1.65] text-watch-ink-2">
            <b className="font-semibold text-watch-ink">Goal:</b> {session.goal}
          </p>
        </div>
        <ConvergenceDial />
      </div>

      <div className="grid grid-cols-4 border-b border-watch-line max-[1120px]:grid-cols-2">
        <MetricCard label="elapsed" value={session.elapsed} detail="source session" />
        <MetricCard label="phase" value={session.phase} detail="from latest event" compact />
        <MetricCard label="events" value={String(session.eventCount)} detail="replayed + live" />
        <MetricCard label="convergence" value="—" detail="judge lands in Slice 6" compact />
      </div>

      {session.convergence?.pivotNudge?.mode === 'loud' ? <PivotCoachingCard session={session} /> : null}
      {interventionCard ? <InterventionCard card={interventionCard} onInspect={onInspectIntervention} onDismiss={onDismissIntervention} /> : null}

      <div className="px-5 pb-12 pt-3">
        <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[.14em] text-watch-ink-3">Timeline lanes</div>
        <div className="overflow-hidden rounded-[11px] border border-watch-line">
          {session.lanes.map((lane) => (
            <LaneRow focusedTimelineItemId={focusedTimelineItemId} lane={lane} key={lane.lane} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EmptyTimeline() {
  return (
    <section className="grid min-h-0 place-items-center bg-transparent p-8">
      <div className="max-w-[460px] rounded-[14px] border border-watch-line bg-watch-card p-5 text-center shadow-watch-card">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-watch-ink-3">Waiting for source activity</div>
        <p className="mt-3 text-[13px] leading-[1.65] text-watch-ink-2">
          The Cockpit is connected to the Flue engine. A Claude session will appear once the adapter records normalized events.
        </p>
      </div>
    </section>
  );
}

function MetricCard({ label, value, detail, tone, compact = false }: { label: string; value: string; detail: string; tone?: Severity; compact?: boolean }) {
  const valueClass = tone ? valueToneClass[tone] : 'text-watch-ink';

  return (
    <div className="border-r border-watch-line px-5 py-3 last:border-r-0">
      <div className="font-mono text-[9px] uppercase tracking-[.12em] text-watch-ink-3">{label}</div>
      <div className={`mt-1.5 truncate font-mono leading-none tracking-[-.02em] ${compact ? 'text-[15px]' : 'text-[22px]'} ${valueClass}`}>{value}</div>
      <div className="mt-1.5 font-mono text-[10px] text-watch-ink-3">{detail}</div>
    </div>
  );
}

function PivotModeToggle({ mode, onChange }: { mode: 'calm' | 'loud'; onChange: (mode: 'calm' | 'loud') => void }) {
  const nextMode = mode === 'calm' ? 'loud' : 'calm';
  return (
    <button
      aria-label="Toggle Pivot nudge mode"
      className="rounded-[5px] border border-watch-line bg-watch-glass-strong px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[.05em] text-watch-ink-2 transition hover:border-watch-accent/45 hover:text-watch-accent"
      onClick={() => onChange(nextMode)}
      type="button"
    >
      Pivot {mode}
    </button>
  );
}

function PivotCoachingCard({ session }: { session: SessionView }) {
  const pivot = session.convergence?.pivotNudge;
  if (!pivot) return null;

  return (
    <article aria-label="Pivot Coaching Card" className="mx-5 mt-4 rounded-[14px] border border-severity-watch/28 bg-watch-card p-4 shadow-watch-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[6px] bg-severity-watch/16 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-severity-watch">Coaching</span>
        <h2 className="text-[13.5px] font-semibold text-watch-ink">{pivot.title}</h2>
        <span className="ml-auto rounded-[6px] border border-watch-line bg-watch-code px-2 py-1 font-mono text-[10px] uppercase text-watch-ink-3">fresh session</span>
      </div>
      <p className="mt-3 text-[12.5px] leading-[1.65] text-watch-ink-2">{pivot.detail}</p>
      <p className="mt-3 rounded-[10px] border border-watch-line bg-watch-bg-deep px-3 py-2 font-mono text-[11px] leading-[1.6] text-watch-ink">{pivot.recommendedAction}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-watch-ink-3">
        <span>Receipt {pivot.eventId}</span>
        <span className="h-1 w-1 rounded-full bg-watch-line-2" />
        <span>{formatClock(pivot.timestamp)}</span>
      </div>
    </article>
  );
}

function LaneRow({ lane, focusedTimelineItemId }: { lane: TimelineLane; focusedTimelineItemId?: string }) {
  return (
    <div className="grid min-h-[42px] grid-cols-[118px_1fr] border-b border-watch-line last:border-b-0 hover:bg-watch-hover-faint">
      <div className="border-r border-watch-line px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-[.06em] text-watch-ink-3">{lane.lane}</div>
      <div className="grid gap-2 px-5 py-2.5 font-mono text-[12px] leading-[1.7] text-watch-ink">
        {lane.items.length === 0 ? <LaneEmpty lane={lane.lane} /> : lane.items.map((item) => <TimelineChip focused={item.id === focusedTimelineItemId} item={item} key={item.id} />)}
      </div>
    </div>
  );
}

function TimelineChip({ item, focused }: { item: TimelineItem; focused?: boolean }) {
  const focusClass = focused ? 'rounded-[7px] border border-severity-intervention/35 bg-evidence-intervention px-2 py-1 shadow-watch-card' : '';
  return (
    <div className={focusClass} id={timelineItemElementId(item.id)}>
      <span className="mr-2 text-[10px] text-watch-ink-3">{formatClock(item.at)}</span>
      <span className={`mr-1 inline-block rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-medium ${chipToneClass[item.tone]}`}>{item.label}</span>
      <span className="text-watch-ink-2">{item.detail}</span>
    </div>
  );
}

function LaneEmpty({ lane }: { lane: string }) {
  const detail = lane === 'convergence' ? 'No convergence judge yet.' : 'No replayed events in this lane yet.';
  return <span className="text-watch-ink-3">{detail}</span>;
}

