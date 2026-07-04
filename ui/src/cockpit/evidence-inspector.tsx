import type { ReactNode } from 'react';
import type { Severity, SessionView } from '../loopwatch-events';
import { healthEndpoint, loopwatchConvergenceEndpoint, loopwatchRunsEndpoint } from './endpoints';
import type { ConvergenceBridgeState, RunBridgeState } from './live-replay';
import type { LoopRecommendationState } from './loop-recommendation';
import { interventionEvidenceKey } from './intervention-card';

export function EvidenceInspector({
  session,
  flueBaseUrl,
  bridgeState,
  convergenceState,
  focusedEvidenceKey,
  loopRecommendation,
}: {
  session: SessionView | undefined;
  flueBaseUrl: string;
  bridgeState: RunBridgeState;
  convergenceState: ConvergenceBridgeState;
  focusedEvidenceKey?: string;
  loopRecommendation: LoopRecommendationState;
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

      <EvidenceCard tone={session?.severity} title="Convergence watcher" number="03">
        <EvidenceDetails rows={convergenceRows(session, convergenceState, flueBaseUrl, focusedEvidenceKey)} />
      </EvidenceCard>

      <EvidenceCard title="Scoped git watcher" number="04">
        <EvidenceDetails rows={gitWatcherRows(session)} />
      </EvidenceCard>

      <EvidenceCard title="Coaching recommendation" number="05">
        <EvidenceDetails rows={loopRecommendationRows(loopRecommendation)} />
      </EvidenceCard>

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

function convergenceRows(session: SessionView | undefined, convergenceState: ConvergenceBridgeState, flueBaseUrl: string, focusedEvidenceKey?: string): EvidenceDetail[] {
  const convergence = session?.convergence;
  if (!convergence) {
    return [
      { label: 'Watcher', detail: convergenceState.detail },
      { label: 'Discovery', detail: loopwatchConvergenceEndpoint(flueBaseUrl) },
      { label: 'Spend', detail: `cheap ${convergenceState.spend.cheapCalls} · strong ${convergenceState.spend.strongCalls} · $${convergenceState.spend.estimatedCostUsd.toFixed(6)}` },
    ];
  }

  const selectedEvidence = convergence.evidence.find((item) => interventionEvidenceKey(session.id, item) === focusedEvidenceKey) ?? convergence.evidence[0];
  const rows: EvidenceDetail[] = [
    { label: 'status', detail: convergence.status },
    { label: 'goal', detail: convergence.summary.goal },
    { label: 'evidence', detail: selectedEvidence?.title ?? 'No convergence concerns' },
    { label: 'signal', detail: selectedEvidence?.signal.replaceAll('_', ' ') ?? 'none' },
    { label: 'receipt', detail: selectedEvidence ? selectedEvidence.detail : 'No evidence receipt selected' },
    { label: 'event id', detail: selectedEvidence?.eventId ?? 'none' },
    { label: 'judge', detail: `${convergence.judge.lastTier ?? 'not run'} · cap ${Math.round(convergence.judge.rateCapMs / 1000)}s` },
    { label: 'spend', detail: `cheap ${convergence.spend.cheapCalls} · strong ${convergence.spend.strongCalls} · ${convergence.spend.estimatedTokens} tokens · $${convergence.spend.estimatedCostUsd.toFixed(6)}` },
  ];

  if (convergence.loopAnchor) {
    rows.splice(
      2,
      0,
      { label: 'loop', detail: `${convergence.loopAnchor.title} · ${Math.round(convergence.loopAnchor.confidence * 100)}%` },
      { label: 'rubric', detail: convergence.loopAnchor.stopCondition.evidence },
    );
  }

  if (convergence.pivotNudge) {
    rows.splice(
      2,
      0,
      { label: 'pivot', detail: `${convergence.pivotNudge.mode} · ${convergence.pivotNudge.title}` },
      { label: 'fresh session', detail: convergence.pivotNudge.recommendedAction },
    );
  }

  return rows;
}

function gitWatcherRows(session: SessionView | undefined): EvidenceDetail[] {
  const git = session?.convergence?.git;
  if (!session) return [{ label: 'scope', detail: 'No active Agent Session selected.' }];
  if (!git) return [{ label: 'scope', detail: 'No scoped git evidence for this active session yet.' }];

  return [
    { label: 'scope', detail: 'Active-session repo only' },
    { label: 'repo', detail: git.repo },
    { label: 'branch', detail: git.branch },
    { label: 'diff', detail: `${git.diff.files} files · +${git.diff.insertions}/-${git.diff.deletions}` },
    { label: 'files', detail: git.changedFiles.length > 0 ? git.changedFiles.slice(0, 6).join(', ') : 'clean working tree' },
    { label: 'validation', detail: git.validation.detail },
    { label: 'head', detail: git.head ? `${git.head.sha.slice(0, 7)} ${git.head.subject}` : 'no commit observed' },
  ];
}

function loopRecommendationRows(recommendation: LoopRecommendationState): EvidenceDetail[] {
  const card = recommendation.card;
  if (!card) return [{ label: 'loop', detail: recommendation.detail }];

  return [
    { label: 'loop', detail: card.loop.title },
    { label: 'why', detail: card.reason },
    { label: 'stop', detail: card.loop.stopCondition.evidence },
    { label: 'copy', detail: <CopyPrompt value={card.copyPrompt} /> },
  ];
}

function CopyPrompt({ value }: { value: string }) {
  return (
    <div className="grid gap-2">
      <textarea
        className="min-h-28 resize-y rounded-[8px] border border-watch-line bg-watch-code px-2 py-1.5 font-mono text-[10.5px] leading-[1.45] text-watch-ink-2 outline-none"
        readOnly
        value={value}
      />
      <button
        className="w-fit rounded-[7px] border border-watch-line bg-watch-panel px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] text-watch-ink-2 hover:border-watch-accent/50 hover:text-watch-accent"
        onClick={() => void navigator.clipboard?.writeText(value)}
        type="button"
      >
        Copy loop prompt
      </button>
    </div>
  );
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
