import type { SessionView } from '../loopwatch-events';
import type { SessionGroup } from './session-model';
import { LivenessPill, StatusPing } from './visual';

export function SessionRail({
  groupedSessions,
  selectedId,
  onSelect,
}: {
  groupedSessions: SessionGroup[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const count = groupedSessions.reduce((sum, group) => sum + group.sessions.length, 0);

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-watch-line bg-watch-bg-side">
      <div className="flex items-center gap-2 border-b border-watch-line px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[.14em] text-watch-ink-3">
        Session rail
        <span className="ml-auto text-[11px] normal-case tracking-normal text-watch-ink-2">{count}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1.5">
        {count === 0 ? (
          <EmptyRail />
        ) : (
          groupedSessions.map((group) => (
            <section className="mt-1.5" key={group.repo}>
              <div className="flex items-center gap-1.5 px-3.5 py-1 font-mono text-[10px] text-watch-ink-3">
                {group.repo}
                <span className="ml-auto opacity-60">{group.sessions.length}</span>
              </div>
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                  onSelect={() => onSelect(session.id)}
                />
              ))}
            </section>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-watch-line px-3.5 py-2.5 text-[10.5px] text-watch-ink-3">
        <span className="font-mono uppercase tracking-[.1em]">Sources</span>
        <span className="rounded-[5px] border border-watch-accent/30 bg-watch-accent/12 px-1.5 py-0.5 font-mono text-[9px] text-watch-accent">
          Claude live
        </span>
      </div>
    </aside>
  );
}

function EmptyRail() {
  return (
    <div className="mx-3 mt-3 rounded-[10px] border border-watch-line bg-watch-card p-3 text-[11.5px] leading-[1.6] text-watch-ink-2">
      Start the Flue engine and Claude Source Adapter. Recorded events will replay here as Agent Sessions.
    </div>
  );
}

function SessionRow({ session, selected, onSelect }: { session: SessionView; selected: boolean; onSelect: () => void }) {
  const selectedClass = selected
    ? 'border-watch-accent/22 bg-watch-selected shadow-watch-selected'
    : 'border-transparent hover:bg-watch-hover';

  return (
    <button
      className={`mx-1.5 grid w-[calc(100%-12px)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border px-3 py-2 text-left transition ${selectedClass}`}
      onClick={onSelect}
      type="button"
    >
      <StatusPing severity={session.severity} active={selected && session.liveness === 'active'} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-watch-ink">{session.title}</span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-watch-ink-3">
          {session.source} · {session.repo} · {session.branch}
        </span>
        <span className="mt-1 block truncate font-mono text-[10px] text-watch-ink-2">phase · {session.phase}</span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className="font-mono text-[10px] text-watch-ink-2">{session.elapsed}</span>
        <LivenessPill liveness={session.liveness} />
      </span>
    </button>
  );
}
