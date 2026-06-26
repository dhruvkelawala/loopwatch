import type { ReactNode } from 'react';
import type { Severity, SessionView } from '../loopwatch-events';
import { healthEndpoint, loopwatchRunsEndpoint } from './endpoints';
import type { RunBridgeState } from './live-replay';

export function EvidenceInspector({
  session,
  flueBaseUrl,
  bridgeState,
}: {
  session: SessionView | undefined;
  flueBaseUrl: string;
  bridgeState: RunBridgeState;
}) {
  return (
    <aside className="min-h-0 overflow-auto border-l border-watch-line bg-gradient-to-b from-watch-panel to-watch-panel-2 max-[980px]:hidden">
      <div className="sticky top-0 z-10 border-b border-watch-line bg-watch-panel px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[.14em] text-watch-ink-3">
        Evidence inspector
      </div>

      <EvidenceCard tone={session?.severity} title="Current read" number="01">
        {session ? (
          <EvidenceDetails rows={currentReadRows(session)} />
        ) : (
          <p className="text-[11.5px] leading-[1.65] text-watch-ink-2">No Agent Session has been replayed yet.</p>
        )}
      </EvidenceCard>

      <EvidenceCard title="Replay bridge" number="02">
        <EvidenceDetails rows={replayBridgeRows(flueBaseUrl, bridgeState)} />
      </EvidenceCard>

      <div className="mx-3 my-3 border-l-2 border-watch-line-2 py-0.5 pl-3 text-[11.5px] leading-[1.65] text-watch-ink-2">
        <b className="font-semibold text-watch-ink">Slice 5 scope:</b> real Claude adapter events now drive the rail and timeline. The convergence lane remains inert until the watcher lands.
      </div>

      <div className="mx-3 my-3 border-l-2 border-severity-watch py-0.5 pl-3 text-[11.5px] leading-[1.65] text-watch-ink-2">
        Health probe: <code className="rounded bg-watch-code px-1.5 py-0.5 font-mono text-[10.5px] text-watch-accent">{healthEndpoint(flueBaseUrl)}</code>
      </div>
    </aside>
  );
}

type EvidenceDetail = {
  label: string;
  detail: ReactNode;
};

function currentReadRows(session: SessionView): EvidenceDetail[] {
  return [
    { label: 'source', detail: session.source },
    { label: 'repo', detail: session.repo },
    { label: 'branch', detail: session.branch },
    { label: 'phase', detail: session.phase },
    { label: 'last event', detail: session.lastEvent },
  ];
}

function replayBridgeRows(flueBaseUrl: string, bridgeState: RunBridgeState): EvidenceDetail[] {
  return [
    { label: 'Transport', detail: '@flue/react replay for completed runs; live hook for active runs' },
    { label: 'Replay', detail: `${bridgeState.eventCount} normalized events from ${bridgeState.runCount} Flue runs` },
    { label: 'Discovery', detail: loopwatchRunsEndpoint(flueBaseUrl) },
    { label: 'Cadence', detail: 'run index polls every 1s; completed runs replay once' },
  ];
}

function EvidenceDetails({ rows }: { rows: EvidenceDetail[] }) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div className="grid grid-cols-[76px_1fr] gap-3 text-[11.5px] leading-[1.55]" key={row.label}>
          <span className="font-mono text-[11px] text-watch-ink-3">{row.label}</span>
          <span>{row.detail}</span>
        </div>
      ))}
    </div>
  );
}

function EvidenceCard({ children, title, number, tone }: { children: ReactNode; title: string; number: string; tone?: Severity }) {
  const toneClass = tone === 'intervention' ? 'border-severity-intervention/32 bg-evidence-intervention' : 'border-watch-line bg-watch-card';
  const titleClass = tone === 'intervention' ? 'text-status-intervention-title' : 'text-watch-ink';

  return (
    <article className={`m-3 rounded-[10px] border p-3.5 shadow-watch-card ${toneClass}`}>
      <div className={`mb-3 flex items-center border-b border-watch-line pb-2 font-mono text-[10px] font-semibold uppercase tracking-[.1em] ${titleClass}`}>
        {title}
        <span className="ml-auto font-normal tracking-normal text-watch-ink-3">{number}</span>
      </div>
      {children}
    </article>
  );
}
