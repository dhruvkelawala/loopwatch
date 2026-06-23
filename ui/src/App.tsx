import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

type EngineState =
  | { kind: 'checking'; label: string; detail: string }
  | { kind: 'connected'; label: string; detail: string }
  | { kind: 'offline'; label: string; detail: string };

const EngineHealthSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  target: z.string(),
});

type EngineHealth = z.infer<typeof EngineHealthSchema>;

const placeholderEvents = [
  { lane: 'request', label: 'Claude transcript adapter', detail: 'Source events will appear here in Slice 5.' },
  { lane: 'tools', label: 'Tool activity', detail: 'Tool calls and results will stack into this lane.' },
  { lane: 'convergence', label: 'Convergence empty', detail: 'The judge arrives later; this lane is reserved.' },
];

const emptySessions = [
  { source: 'claude', repo: 'loopwatch', branch: 'slices/tauri-cockpit-shell', phase: 'shell' },
  { source: 'codex', repo: 'future adapter', branch: 'not wired', phase: 'placeholder' },
];

export function App({ flueBaseUrl }: { flueBaseUrl: string }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = emptySessions[selectedIndex] ?? emptySessions[0];

  return (
    <main className="cockpit-shell">
      <header className="titlebar" aria-label="Loopwatch cockpit header">
        <div className="traffic" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Loopwatch Cockpit</p>
          <h1>Watchtower</h1>
        </div>
        <EngineConnection flueBaseUrl={flueBaseUrl} />
      </header>

      <section className="cockpit-grid" aria-label="Empty Cockpit layout">
        <aside className="panel rail" aria-label="Session rail">
          <div className="panel-heading">
            <span>Session rail</span>
            <strong>Slice 4 shell</strong>
          </div>
          <div className="rail-list">
            {emptySessions.map((session, index) => (
              <button
                className={`session-row ${index === selectedIndex ? 'selected' : ''}`}
                key={`${session.source}:${session.repo}`}
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                <span className="source-pill">{session.source}</span>
                <strong>{session.repo}</strong>
                <small>{session.branch}</small>
                <em>{session.phase}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel timeline" aria-label="Session timeline">
          <div className="panel-heading">
            <span>Timeline</span>
            <strong>{selected.repo}</strong>
          </div>
          <div className="dial-wrap" aria-label="Reserved convergence dial">
            <ConvergenceDial />
            <div>
              <p className="eyebrow cyan">empty data surface</p>
              <h2>No live session selected yet</h2>
              <p>
                This webview is connected to the local Flue engine. Slice 5 will replace these
                placeholders with replayed Claude events and a live tail.
              </p>
            </div>
          </div>
          <div className="lanes" aria-label="Timeline lane placeholders">
            {placeholderEvents.map((event) => (
              <article className="lane-card" key={event.lane}>
                <span>{event.lane}</span>
                <h3>{event.label}</h3>
                <p>{event.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel inspector" aria-label="Evidence inspector">
          <div className="panel-heading">
            <span>Evidence inspector</span>
            <strong>reserved</strong>
          </div>
          <div className="evidence-card primary">
            <p className="eyebrow">connection</p>
            <h2>@flue/react ready</h2>
            <p>
              The real Cockpit will use Flue hooks to replay bounded history, then stream live
              updates. This slice proves the shell can host the provider.
            </p>
          </div>
          <div className="evidence-list">
            <span>rail / timeline / inspector regions rendered</span>
            <span>health probe hits {healthEndpoint(flueBaseUrl)}</span>
            <span>@flue/sdk client mounted at {flueBaseUrl}</span>
            <span>real source events intentionally deferred</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function EngineConnection({ flueBaseUrl }: { flueBaseUrl: string }) {
  const health = useQuery({
    queryKey: ['engine-health', flueBaseUrl],
    queryFn: ({ signal }) => fetchEngineHealth(flueBaseUrl, signal),
    refetchInterval: 5000,
    staleTime: 2500,
  });

  let state: EngineState;
  if (health.isPending) {
    state = { kind: 'checking', label: 'checking engine', detail: healthEndpoint(flueBaseUrl) };
  } else if (health.isSuccess) {
    state = {
      kind: 'connected',
      label: 'engine connected',
      detail: `${health.data.service} (${health.data.target}) via ${healthEndpoint(flueBaseUrl)}`,
    };
  } else {
    state = {
      kind: 'offline',
      label: 'engine offline',
      detail: health.error instanceof Error ? health.error.message : 'Unknown health probe error',
    };
  }

  return (
    <div className={`engine-status ${state.kind}`} title={state.detail}>
      <span aria-hidden="true" />
      <div>
        <strong>{state.label}</strong>
        <small>{state.detail}</small>
      </div>
    </div>
  );
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

function ConvergenceDial() {
  return (
    <div className="convergence-dial" aria-hidden="true">
      <span className="ring outer" />
      <span className="ring middle" />
      <span className="ring inner" />
      <span className="sweep" />
      <span className="contact" />
    </div>
  );
}
