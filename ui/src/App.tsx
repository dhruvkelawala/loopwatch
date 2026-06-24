import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';

type EngineState =
  | { kind: 'checking'; label: string; detail: string }
  | { kind: 'connected'; label: string; detail: string }
  | { kind: 'offline'; label: string; detail: string };

type Severity = 'intervention' | 'watch' | 'calm';
type Liveness = 'active' | 'idle' | 'ended';

type SessionSummary = {
  id: string;
  source: string;
  title: string;
  repo: string;
  branch: string;
  goal: string;
  severity: Severity;
  liveness: Liveness;
  elapsed: string;
  drift: number;
  loops: number;
  validations: string;
  lastEvent: string;
};

type TimelineLane = {
  lane: string;
  items: Array<{ label: string; tone: Severity | 'neutral'; detail: string }>;
};

const EngineHealthSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  target: z.string(),
});

type EngineHealth = z.infer<typeof EngineHealthSchema>;

const sessions: SessionSummary[] = [
  {
    id: 'claude-tauri-shell',
    source: 'Claude',
    title: 'Tauri Cockpit shell',
    repo: 'loopwatch',
    branch: 'slices/tauri-cockpit-shell',
    goal: 'Turn the approved Watchtower concept into the real desktop Cockpit shell.',
    severity: 'watch',
    liveness: 'active',
    elapsed: '22m',
    drift: 18,
    loops: 2,
    validations: 'ui + tauri green',
    lastEvent: 'health probe connected through /api/health',
  },
  {
    id: 'claude-adapter',
    source: 'Claude',
    title: 'Claude transcript adapter',
    repo: 'loopwatch',
    branch: 'main',
    goal: 'Tail source transcripts into normalized Loopwatch events.',
    severity: 'calm',
    liveness: 'ended',
    elapsed: '1h 48m',
    drift: 4,
    loops: 0,
    validations: 'adapter:check 12/12',
    lastEvent: 'merged as Slice 3',
  },
  {
    id: 'future-live-session',
    source: 'Claude',
    title: 'Live session stream',
    repo: 'loopwatch',
    branch: 'slice-5',
    goal: 'Replay and stream a real Claude session into this rail and timeline.',
    severity: 'intervention',
    liveness: 'idle',
    elapsed: 'queued',
    drift: 34,
    loops: 5,
    validations: 'not wired yet',
    lastEvent: 'waiting for Slice 5',
  },
];

const severityGroups: Array<{ severity: Severity; label: string }> = [
  { severity: 'intervention', label: 'Needs intervention' },
  { severity: 'watch', label: 'Watch closely' },
  { severity: 'calm', label: 'Calm' },
];

const lanes: TimelineLane[] = [
  {
    lane: 'request',
    items: [
      {
        label: 'Slice 4c visual pass',
        tone: 'watch',
        detail: 'Replace the scaffold shell with the approved Watchtower instrument deck.',
      },
    ],
  },
  {
    lane: 'tools',
    items: [
      {
        label: 'TanStack health query',
        tone: 'calm',
        detail: 'The engine probe remains query-managed and points at the explicit /health route.',
      },
      {
        label: 'Tauri process supervisor',
        tone: 'neutral',
        detail: 'Rust owns the local Flue Node process; lifecycle behaviour lands in 4d.',
      },
    ],
  },
  {
    lane: 'files',
    items: [
      {
        label: 'Tailwind v4 surface',
        tone: 'calm',
        detail: 'The real app now uses utility-first styling with a small Watchtower theme layer.',
      },
    ],
  },
  {
    lane: 'validation',
    items: [
      {
        label: 'Visual smoke pending',
        tone: 'watch',
        detail: 'After this slice builds, capture the Cockpit in-browser and in the Tauri webview.',
      },
    ],
  },
  {
    lane: 'convergence',
    items: [
      {
        label: 'Reserved lane',
        tone: 'neutral',
        detail: 'The judge is not running yet; this lane is intentionally inert until Slice 6.',
      },
    ],
  },
];

const evidence = [
  ['Engine', 'Flue Node process supervised by Tauri'],
  ['Transport', '@flue/react + @flue/sdk mounted'],
  ['Health', 'GET /health via TanStack Query'],
  ['Data', 'Mock session summaries until Slice 5'],
];

export function App({ flueBaseUrl }: { flueBaseUrl: string }) {
  const [selectedId, setSelectedId] = useState(sessions[0]?.id ?? '');
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const groupedSessions = useMemo(groupSessionsBySeverity, []);

  return (
    <main className="grid h-screen grid-rows-[42px_1fr_26px] overflow-hidden bg-watch-shell font-sans text-[12.5px] tracking-[-0.005em] text-watch-ink antialiased">
      <TitleBar flueBaseUrl={flueBaseUrl} />

      <section className="grid min-h-0 grid-cols-[244px_minmax(520px,1fr)_312px] overflow-hidden max-[980px]:grid-cols-[224px_minmax(480px,1fr)]">
        <SessionRail groupedSessions={groupedSessions} selectedId={selected.id} onSelect={setSelectedId} />
        <Timeline session={selected} />
        <EvidenceInspector session={selected} flueBaseUrl={flueBaseUrl} />
      </section>

      <footer className="flex items-center gap-4 border-t border-watch-line bg-watch-bg-deep px-4 font-mono text-[10px] text-watch-ink-3">
        <span>Loopwatch Cockpit · Watchtower</span>
        <span className="h-1 w-1 rounded-full bg-watch-line-2" />
        <span>Pulse → notification → Cockpit remains unchanged</span>
        <span className="ml-auto text-watch-ink-2">real session data lands in Slice 5</span>
      </footer>
    </main>
  );
}

function TitleBar({ flueBaseUrl }: { flueBaseUrl: string }) {
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
      <div className="flex-1" />
      <EngineConnection flueBaseUrl={flueBaseUrl} />
    </header>
  );
}

function EngineConnection({ flueBaseUrl }: { flueBaseUrl: string }) {
  const health = useQuery<EngineHealth, Error>({
    queryKey: ['engine-health', flueBaseUrl],
    queryFn: ({ signal }) => fetchEngineHealth(flueBaseUrl, signal),
    refetchInterval: 5000,
    staleTime: 2500,
  });
  const state = engineState(health, flueBaseUrl);
  const colorClass = engineColorClass[state.kind];

  return (
    <div
      className="flex max-w-[360px] items-center gap-2 rounded-[7px] border border-watch-line bg-watch-glass px-2.5 py-1 font-mono text-[11px] text-watch-ink-2"
      title={state.detail}
    >
      <span className={`h-2 w-2 rounded-full ${colorClass}`} aria-hidden="true" />
      <span className="font-medium text-watch-ink">{state.label}</span>
      <span className="truncate text-watch-ink-3">{state.detail}</span>
    </div>
  );
}

function SessionRail({
  groupedSessions,
  selectedId,
  onSelect,
}: {
  groupedSessions: ReturnType<typeof groupSessionsBySeverity>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-watch-line bg-watch-bg-side">
      <div className="flex items-center gap-2 border-b border-watch-line px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[.14em] text-watch-ink-3">
        Session rail
        <span className="ml-auto text-[11px] normal-case tracking-normal text-watch-ink-2">{sessions.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1.5">
        {groupedSessions.map((group) => (
          <section className="mt-1.5" key={group.severity}>
            <div className="flex items-center gap-1.5 px-3.5 py-1 font-mono text-[10px] text-watch-ink-3">
              {group.label}
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
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-watch-line px-3.5 py-2.5 text-[10.5px] text-watch-ink-3">
        <span className="font-mono uppercase tracking-[.1em]">Sources</span>
        <span className="rounded-[5px] border border-watch-accent/30 bg-watch-accent/12 px-1.5 py-0.5 font-mono text-[9px] text-watch-accent">
          Claude
        </span>
        <span className="rounded-[5px] border border-watch-line bg-watch-subtle px-1.5 py-0.5 font-mono text-[9px] text-watch-ink-2">
          Codex later
        </span>
      </div>
    </aside>
  );
}

function SessionRow({ session, selected, onSelect }: { session: SessionSummary; selected: boolean; onSelect: () => void }) {
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
        <span className="mt-0.5 block truncate font-mono text-[10px] text-watch-ink-3">{session.repo} · {session.branch}</span>
      </span>
      <span className="grid justify-items-end gap-1">
        <SeverityBadge severity={session.severity} />
        <LivenessPill liveness={session.liveness} />
      </span>
    </button>
  );
}

function Timeline({ session }: { session: SessionSummary }) {
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
        <ConvergenceDial drift={session.drift} />
      </div>

      <div className="grid grid-cols-4 border-b border-watch-line max-[1120px]:grid-cols-2">
        <MetricCard label="elapsed" value={session.elapsed} detail="current session" />
        <MetricCard label="drift" value={`${session.drift}°`} detail="from inferred goal" tone={session.severity} />
        <MetricCard label="loops" value={String(session.loops)} detail="repeated patterns" />
        <MetricCard label="validation" value={session.validations} detail="latest signal" compact />
      </div>

      <div className="px-5 pb-12 pt-3">
        <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[.14em] text-watch-ink-3">Timeline lanes</div>
        <div className="overflow-hidden rounded-[11px] border border-watch-line">
          {lanes.map((lane) => (
            <LaneRow lane={lane} key={lane.lane} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EvidenceInspector({ session, flueBaseUrl }: { session: SessionSummary; flueBaseUrl: string }) {
  return (
    <aside className="min-h-0 overflow-auto border-l border-watch-line bg-gradient-to-b from-watch-panel to-watch-panel-2 max-[980px]:hidden">
      <div className="sticky top-0 z-10 border-b border-watch-line bg-watch-panel px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[.14em] text-watch-ink-3">
        Evidence inspector
      </div>

      <EvidenceCard tone={session.severity} title="Current read" number="01">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11.5px] leading-[1.6]">
          <span className="font-mono text-[11px] text-watch-ink-3">status</span>
          <span className={valueToneClass[session.severity]}>{severityLabel[session.severity]}</span>
          <span className="font-mono text-[11px] text-watch-ink-3">liveness</span>
          <span>{session.liveness}</span>
          <span className="font-mono text-[11px] text-watch-ink-3">last event</span>
          <span>{session.lastEvent}</span>
        </div>
      </EvidenceCard>

      <EvidenceCard title="Shell wiring" number="02">
        <div className="grid gap-2">
          {evidence.map(([label, detail]) => (
            <div className="grid grid-cols-[76px_1fr] gap-3 text-[11.5px] leading-[1.55]" key={label}>
              <span className="font-mono text-[11px] text-watch-ink-3">{label}</span>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </EvidenceCard>

      <div className="mx-3 my-3 border-l-2 border-watch-line-2 py-0.5 pl-3 text-[11.5px] leading-[1.65] text-watch-ink-2">
        <b className="font-semibold text-watch-ink">4c scope:</b> this is still a data placeholder. The real rail rows and lanes will come from the normalized event store in Slice 5.
      </div>

      <div className="mx-3 my-3 border-l-2 border-severity-watch py-0.5 pl-3 text-[11.5px] leading-[1.65] text-watch-ink-2">
        Health probe: <code className="rounded bg-watch-code px-1.5 py-0.5 font-mono text-[10.5px] text-watch-accent">{healthEndpoint(flueBaseUrl)}</code>
      </div>
    </aside>
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
        {lane.items.map((item) => (
          <div key={`${lane.lane}:${item.label}`}>
            <span className={`mr-1 inline-block rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-medium ${chipToneClass[item.tone]}`}>{item.label}</span>
            <span className="text-watch-ink-2">{item.detail}</span>
          </div>
        ))}
      </div>
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

function ConvergenceDial({ drift }: { drift: number }) {
  const contact = polarPoint(28, 28, Math.min(21, 7 + drift / 2), -35);

  return (
    <div className="w-[76px] shrink-0 text-center">
      <svg className="mx-auto block text-watch-accent" height="56" viewBox="0 0 56 56" width="56" aria-hidden="true">
        <circle cx="28" cy="28" fill="none" opacity="0.35" r="24" stroke="currentColor" strokeWidth="1" />
        <circle cx="28" cy="28" fill="none" opacity="0.25" r="15" stroke="currentColor" strokeWidth="1" />
        <circle cx="28" cy="28" fill="currentColor" opacity="0.18" r="5" />
        <path className="animate-watchtower-sweep" d="M28 28 L28 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        <circle className="animate-watchtower-blip" cx={contact.x} cy={contact.y} fill="currentColor" r="3.4" />
      </svg>
      <span className="mt-1 block font-mono text-[8.5px] font-medium uppercase tracking-[.14em] text-watch-ink-3">drift {drift}°</span>
    </div>
  );
}

function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" fill="none" opacity=".5" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" fill="none" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" fill="currentColor" r="1.4" />
      <path d="M16.5 7.5a9 9 0 1 0 3 7.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M17.5 4.5l2 2-2 2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

function StatusPing({ severity, active }: { severity: Severity; active: boolean }) {
  const colorClass = pingColorClass[severity];
  const pulseClass = active ? 'after:absolute after:inset-0 after:animate-watchtower-ping after:rounded-full after:border after:border-current' : '';

  return (
    <span className={`relative h-[9px] w-[9px] ${colorClass} ${pulseClass}`}>
      <span className="absolute inset-px rounded-full bg-current shadow-watch-ping" />
    </span>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded px-1.5 py-[1.5px] font-mono text-[9.5px] font-medium uppercase tracking-[.05em] ${severityBadgeClass[severity]}`}>
      {severityLabel[severity]}
    </span>
  );
}

function LivenessPill({ liveness }: { liveness: Liveness }) {
  return (
    <span className={`rounded border px-1.5 py-[1.5px] font-mono text-[9px] font-medium uppercase tracking-[.02em] ${livenessClass[liveness]}`}>
      {liveness}
    </span>
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

function healthEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/health`;
}

async function fetchEngineHealth(baseUrl: string, signal?: AbortSignal): Promise<EngineHealth> {
  const response = await fetch(healthEndpoint(baseUrl), { signal });
  if (!response.ok) throw new Error(`Health probe failed with HTTP ${response.status}`);
  return EngineHealthSchema.parse(await response.json());
}

function groupSessionsBySeverity() {
  return severityGroups.map((group) => ({
    ...group,
    sessions: sessions.filter((session) => session.severity === group.severity),
  }));
}

function polarPoint(cx: number, cy: number, radius: number, angleDegrees: number) {
  const radians = (angleDegrees - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

const severityLabel: Record<Severity, string> = {
  intervention: 'intervene',
  watch: 'watch',
  calm: 'calm',
};

const severityBadgeClass: Record<Severity, string> = {
  intervention: 'bg-severity-intervention/14 text-severity-intervention',
  watch: 'bg-severity-watch/16 text-severity-watch',
  calm: 'bg-severity-calm/14 text-severity-calm',
};

const livenessClass: Record<Liveness, string> = {
  active: 'border-severity-calm/40 bg-severity-calm/14 text-severity-calm',
  idle: 'border-liveness-idle/30 bg-liveness-idle/8 text-liveness-idle',
  ended: 'border-liveness-ended/25 bg-liveness-ended/6 text-liveness-ended',
};

const valueToneClass: Record<Severity, string> = {
  intervention: 'text-status-intervention',
  watch: 'text-status-watch',
  calm: 'text-status-calm',
};

const chipToneClass: Record<Severity | 'neutral', string> = {
  intervention: 'bg-severity-intervention/14 text-status-intervention',
  watch: 'bg-severity-watch/16 text-status-watch',
  calm: 'bg-severity-calm/14 text-status-calm',
  neutral: 'bg-watch-code text-watch-ink-2',
};

const pingColorClass: Record<Severity, string> = {
  intervention: 'text-severity-intervention',
  watch: 'text-severity-watch',
  calm: 'text-severity-calm',
};

const engineColorClass: Record<EngineState['kind'], string> = {
  checking: 'bg-severity-watch shadow-watch-warn-glow',
  connected: 'bg-watch-accent shadow-watch-accent-glow',
  offline: 'bg-severity-intervention shadow-watch-danger-glow',
};
