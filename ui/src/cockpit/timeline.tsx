import type { Severity, SessionView, TimelineItem, TimelineLane } from '../loopwatch-events';
import { chipToneClass, ConvergenceDial, formatClock, LivenessPill, SeverityBadge, valueToneClass } from './visual';

export function Timeline({ session }: { session: SessionView | undefined }) {
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

      <div className="px-5 pb-12 pt-3">
        <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[.14em] text-watch-ink-3">Timeline lanes</div>
        <div className="overflow-hidden rounded-[11px] border border-watch-line">
          {session.lanes.map((lane) => (
            <LaneRow lane={lane} key={lane.lane} />
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

function LaneRow({ lane }: { lane: TimelineLane }) {
  return (
    <div className="grid min-h-[42px] grid-cols-[118px_1fr] border-b border-watch-line last:border-b-0 hover:bg-watch-hover-faint">
      <div className="border-r border-watch-line px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-[.06em] text-watch-ink-3">{lane.lane}</div>
      <div className="grid gap-2 px-5 py-2.5 font-mono text-[12px] leading-[1.7] text-watch-ink">
        {lane.items.length === 0 ? <LaneEmpty lane={lane.lane} /> : lane.items.map((item) => <TimelineChip item={item} key={item.id} />)}
      </div>
    </div>
  );
}

function TimelineChip({ item }: { item: TimelineItem }) {
  return (
    <div>
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

