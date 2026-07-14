import type { MouseEvent } from 'react';
import type { SessionConvergence, SessionView } from '../loopwatch-events';
import { formatClock } from './visual';

export type ConvergenceEvidence = SessionConvergence['evidence'][number];

export type InterventionCardModel = {
  id: string;
  sessionId: string;
  timelineItemId: string;
  title: string;
  detail: string;
  signal: ConvergenceEvidence['signal'];
  evidenceEventId: string;
  evidenceTimestamp: string;
  recommendedAction: string;
};


export function interventionCardForSession(session: SessionView | undefined, dismissedIds: ReadonlySet<string>): InterventionCardModel | undefined {
  const convergence = session?.convergence;
  if (!session || !convergence || convergence.status !== 'intervention') return undefined;

  const evidence = convergence.evidence.find(
    (item) => item.severity === 'intervention' && recommendedActionFromEvidence(item) && !dismissedIds.has(interventionEvidenceKey(session.id, item)),
  );
  if (!evidence) return undefined;

  const id = interventionEvidenceKey(session.id, evidence);

  return {
    id,
    sessionId: session.id,
    timelineItemId: `${session.id}:convergence:${evidence.eventId}:${evidence.signal}`,
    title: evidence.title,
    detail: evidence.detail,
    signal: evidence.signal,
    evidenceEventId: evidence.eventId,
    evidenceTimestamp: evidence.timestamp,
    recommendedAction: recommendedActionFromEvidence(evidence),
  };
}

export function interventionEvidenceKey(sessionId: string, evidence: Pick<ConvergenceEvidence, 'eventId' | 'signal'>): string {
  return `${sessionId}:${evidence.eventId}:${evidence.signal}`;
}

function recommendedActionFromEvidence(evidence: ConvergenceEvidence): string {
  return evidence.recommendedAction?.trim() ?? '';
}

export function timelineItemElementId(itemId: string): string {
  return `timeline-${itemId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function InterventionCard({ card, onInspect, onDismiss }: { card: InterventionCardModel; onInspect: (card: InterventionCardModel) => void; onDismiss: (id: string) => void }) {
  const inspect = () => onInspect(card);
  const dismiss = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDismiss(card.id);
  };

  return (
    <article className="mx-5 mt-4 rounded-[12px] border border-severity-intervention/40 bg-evidence-intervention p-4 shadow-watch-card" aria-label="Intervention Card">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-status-intervention-title">Intervention card</div>
          <h2 className="mt-2 text-[15px] font-semibold leading-snug text-watch-ink">{card.title}</h2>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-watch-ink-2">{card.detail}</p>
        </div>
        <span className="rounded-[6px] border border-severity-intervention/35 bg-severity-intervention/14 px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] text-status-intervention">
          {card.signal.replaceAll('_', ' ')}
        </span>
      </div>

      <div className="mt-3 rounded-[9px] border border-watch-line bg-watch-glass-strong p-3">
        <div className="font-mono text-[10px] uppercase tracking-[.12em] text-watch-ink-3">Recommended action</div>
        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-watch-ink">{card.recommendedAction}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-watch-ink-3">
        <span>Receipt {card.evidenceEventId}</span>
        <span className="h-1 w-1 rounded-full bg-watch-line-2" />
        <span>{formatClock(card.evidenceTimestamp)}</span>
        <button className="ml-auto rounded-[6px] border border-watch-accent/30 bg-watch-accent/12 px-2.5 py-1 text-watch-accent transition hover:bg-watch-hover" onClick={inspect} type="button">
          Inspect evidence
        </button>
        <button className="rounded-[6px] border border-watch-line bg-watch-code px-2.5 py-1 text-watch-ink-2 transition hover:bg-watch-hover" onClick={dismiss} type="button">
          Dismiss
        </button>
      </div>
    </article>
  );
}
